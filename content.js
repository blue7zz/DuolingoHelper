// content script：在面板顶部新增手动输入框，可自定义句子解析
let TARGET_CLASS_FRAGMENTS = ["_2jz5U"]; // 可配置的 class 片段列表，默认值
const PANEL_ID = "duolingo-deepseek-panel";

let observing = false;
let enableMarkdown = true;
let autoExplain = false;
const seenSentences = new Set(); // 已出现的句子（包含手动与自动）
const highlightTimeouts = new Map();

// 加载配置
chrome.storage.sync.get(["enableMarkdown", "autoExplain", "customClassFragments"], cfg => {
  if (cfg.enableMarkdown !== undefined) enableMarkdown = cfg.enableMarkdown;
  autoExplain = cfg.autoExplain === true;
  
  // 加载自定义 class 片段
  if (cfg.customClassFragments && cfg.customClassFragments.length > 0) {
    TARGET_CLASS_FRAGMENTS = [...cfg.customClassFragments];
  }
});

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ddp-header">
        <span>Deepseek 解析</span>
        <button id="ddp-toggle-btn" title="收起">‹</button>
      </div>
      <div class="ddp-body">
        <div class="ddp-manual">
          <input id="ddp-manual-input" type="text" placeholder="输入或粘贴要解析的句子..." />
          <button id="ddp-manual-submit" title="发送解析">解析</button>
          <button id="ddp-manual-clear" class="secondary" title="清空输入框">清空</button>
        </div>
        <div class="ddp-hint">
          捕获到正确答案会列在下方。你也可以手动输入句子点击解析。
          ${autoExplain ? "<br/><strong>当前为自动模式：自动捕获的句子会直接请求。</strong>" : "<br/>自动模式未开启：自动捕获仅列出，需手动点解析。"}
        </div>
        <div id="ddp-candidate-list"></div>
      </div>
      <div class="ddp-footer">
        <small style="opacity:.7;">Duolingo Deepseek Helper</small>
      </div>
      <div class="ddp-expand-btn" id="ddp-expand-btn" title="打开" style="display: none;">›</div>
    `;
    document.body.appendChild(panel);
    
    // Toggle functionality for collapse/expand
    const toggleBtn = document.getElementById("ddp-toggle-btn");
    const expandBtn = document.getElementById("ddp-expand-btn");
    
    function togglePanel() {
      if (panel.classList.contains("collapsed")) {
        // Expand
        panel.classList.remove("collapsed");
        toggleBtn.textContent = "‹";
        toggleBtn.title = "收起";
        expandBtn.style.display = "none";
      } else {
        // Collapse
        panel.classList.add("collapsed");
        toggleBtn.textContent = "›";
        toggleBtn.title = "展开";
        expandBtn.style.display = "block";
      }
    }
    
    toggleBtn.addEventListener("click", togglePanel);
    expandBtn.addEventListener("click", togglePanel);

    // 绑定手动输入事件
    const inputEl = panel.querySelector("#ddp-manual-input");
    const submitBtn = panel.querySelector("#ddp-manual-submit");
    const clearBtn = panel.querySelector("#ddp-manual-clear");

    submitBtn.addEventListener("click", () => {
      const sentence = (inputEl.value || "").trim();
      if (sentence.length < 2) {
        inputEl.focus();
        return;
      }
      handleManualSentence(sentence);
    });

    clearBtn.addEventListener("click", () => {
      inputEl.value = "";
      inputEl.focus();
    });

    // 回车快捷提交
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitBtn.click();
      }
    });
  }
  return panel;
}

function getCandidateListEl() {
  ensurePanel();
  return document.getElementById("ddp-candidate-list");
}

function addCandidate(sentence, opts = {}) {
  const { autoStart = false, manual = false } = opts;
  const list = getCandidateListEl();

  let existing = list.querySelector(`.ddp-candidate[data-sentence-hash="${hash(sentence)}"]`);
  if (existing) {
    // 已存在：高亮 & 如果未解析且请求方式允许，触发
    highlight(existing);
    if (autoStart && existing.querySelector(".ddp-explanation-content")?.innerHTML && existing.querySelector(".ddp-explanation-block")?.style.display !== "none") {
      const btn = existing.querySelector(".ddp-explain-btn");
      if (btn && !btn.disabled) btn.click();
    }
    return existing;
  }

  const container = document.createElement("div");
  container.className = "ddp-candidate";
  container.dataset.sentenceHash = hash(sentence);
  container.dataset.manual = manual ? "1" : "0";

  container.innerHTML = `
    <div class="ddp-sentence">${escapeHtml(sentence)}</div>
    <div class="ddp-actions">
      <button class="ddp-explain-btn">解析</button>
      <button class="ddp-regenerate-btn" style="display:none;">重新生成</button>
    </div>
    <div class="ddp-status"></div>
    <div class="ddp-explanation-block" style="display:none;">
      <div class="ddp-explanation-content"></div>
      <div class="ddp-followup" style="display:none;">
        <div class="ddp-followup-input-container">
          <input class="ddp-followup-input" type="text" placeholder="对这个解析有其他问题？输入追问..." />
          <button class="ddp-followup-btn">追问</button>
        </div>
        <div class="ddp-followup-status"></div>
        <div class="ddp-followup-content"></div>
      </div>
    </div>
  `;

  const explainBtn = container.querySelector(".ddp-explain-btn");
  const regenBtn = container.querySelector(".ddp-regenerate-btn");
  const statusEl = container.querySelector(".ddp-status");
  const blockEl = container.querySelector(".ddp-explanation-block");
  const contentEl = container.querySelector(".ddp-explanation-content");
  const followupEl = container.querySelector(".ddp-followup");
  const followupInput = container.querySelector(".ddp-followup-input");
  const followupBtn = container.querySelector(".ddp-followup-btn");
  const followupStatus = container.querySelector(".ddp-followup-status");
  const followupContent = container.querySelector(".ddp-followup-content");

  explainBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, contentEl, followupEl, explainBtn, regenBtn, first: true });
  });

  regenBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, contentEl, followupEl, explainBtn, regenBtn, first: false, regenerate: true });
  });

  // Follow-up question event handlers
  followupBtn.addEventListener("click", () => {
    const question = followupInput.value.trim();
    if (question.length < 2) {
      followupInput.focus();
      return;
    }
    requestFollowup(sentence, question, { followupStatus, followupContent, followupInput, contentEl });
  });

  followupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      followupBtn.click();
    }
  });

  list.prepend(container);
  ensurePanel().style.display = "flex";
  highlight(container);

  if (autoStart) {
    requestExplanation(sentence, { container, statusEl, blockEl, contentEl, followupEl, explainBtn, regenBtn, first: true });
  }

  return container;
}

function requestFollowup(originalSentence, followupQuestion, ctx) {
  const { followupStatus, followupContent, followupInput, contentEl } = ctx;
  
  followupStatus.innerHTML = `<span class="spinner"></span> 正在追问...`;
  followupContent.style.display = "none";
  
  // Get the original explanation content
  const originalExplanation = contentEl.textContent || contentEl.innerText || "";
  
  chrome.runtime.sendMessage(
    { 
      type: "DEEPSEEK_FOLLOWUP", 
      originalSentence,
      originalExplanation,
      followupQuestion 
    },
    (resp) => {
      if (!resp) {
        followupStatus.innerHTML = `<span class="ddp-error">无响应（权限或后台异常）</span>`;
        return;
      }
      if (resp.ok) {
        followupStatus.textContent = "追问完成";
        const html = enableMarkdown ? simpleMarkdown(resp.explanation)
          : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(resp.explanation)}</pre>`;
        followupContent.innerHTML = html;
        followupContent.style.display = "block";
        followupInput.value = ""; // Clear the input
      } else {
        followupStatus.innerHTML = `<span class="ddp-error">${escapeHtml(resp.error || "追问失败")}</span>`;
      }
    }
  );
}

function requestExplanation(sentence, ctx) {
  const { statusEl, blockEl, contentEl, followupEl, explainBtn, regenBtn } = ctx;
  statusEl.innerHTML = `<span class="spinner"></span> 正在请求...`;
  blockEl.style.display = "none";
  followupEl.style.display = "none";
  explainBtn.disabled = true;
  regenBtn.style.display = "none";
  regenBtn.disabled = true;

  chrome.runtime.sendMessage(
    { type: "DEEPSEEK_EXPLAIN", answerText: sentence },
    (resp) => {
      explainBtn.disabled = false;
      if (!resp) {
        statusEl.innerHTML = `<span class="ddp-error">无响应（权限或后台异常）</span>`;
        regenBtn.style.display = "inline-block";
        regenBtn.disabled = false;
        return;
      }
      if (resp.ok) {
        statusEl.textContent = "完成";
        const html = enableMarkdown ? simpleMarkdown(resp.explanation)
          : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(resp.explanation)}</pre>`;
        contentEl.innerHTML = html;
        blockEl.style.display = "block";
        followupEl.style.display = "block";
        regenBtn.style.display = "inline-block";
        regenBtn.disabled = false;
      } else {
        statusEl.innerHTML = `<span class="ddp-error">${escapeHtml(resp.error || "未知错误")}</span>`;
        regenBtn.style.display = "inline-block";
        regenBtn.disabled = false;
      }
    }
  );
}

function handleManualSentence(sentence) {
  const existed = seenSentences.has(sentence);
  seenSentences.add(sentence);
  const candidate = addCandidate(sentence, { autoStart: true, manual: true });
  if (existed) {
    // 如果已经有解析，则不自动请求
    const blockEl = candidate.querySelector(".ddp-explanation-content");
    if (blockEl && blockEl.innerHTML.trim()) {
      // 已有解析，不再请求
    }
  }
  // 清空输入框
  const inputEl = document.getElementById("ddp-manual-input");
  if (inputEl) inputEl.value = "";
  inputEl?.focus();
}

function initObserver() {
  if (observing) return;
  observing = true;
  const observer = new MutationObserver(muts => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        checkNode(node);
        // 检查任意包含目标 class 片段的节点
        TARGET_CLASS_FRAGMENTS.forEach(fragment => {
          node.querySelectorAll?.(`div[class*="${fragment}"]`)?.forEach(checkNode);
        });
      }
    }
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

function checkNode(node) {
  if (!node.className || typeof node.className !== "string") return;
  
  // 检查节点的 class 是否包含任一目标片段
  const hasTargetClass = TARGET_CLASS_FRAGMENTS.some(fragment => 
    node.className.includes(fragment)
  );
  
  if (!hasTargetClass) return;
  
  const text = node.textContent?.trim();
  if (text && !seenSentences.has(text) && isLikelyValidSentence(text)) {
    seenSentences.add(text);
    addCandidate(text, { autoStart: autoExplain, manual: false });
  }
}

function containsChinese(text) {
  // Check for Chinese characters (CJK unified ideographs)
  return /[\u4e00-\u9fff]/.test(text);
}

function isLikelyValidSentence(text) {
  if (text.length < 2) return false;
  // Filter out sentences containing Chinese characters
  if (containsChinese(text)) return false;
  return true;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// 简易 Markdown 转 HTML
function simpleMarkdown(text) {
  const safe = escapeHtml(text)
    .replace(/^###### (.*)$/gm, "<h6>$1</h6>")
    .replace(/^##### (.*)$/gm, "<h5>$1</h5>")
    .replace(/^#### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, m => "<ul>" + m.replace(/\n/g, "") + "</ul>")
    .replace(/\n/g, "<br/>");
  return safe;
}

// 句子字符串做一个 hash（简易，用于选择器标识）
function hash(str) {
  let h = 0, i = 0, len = str.length;
  while (i < len) {
    h = (h << 5) - h + str.charCodeAt(i++) | 0;
  }
  return "h" + (h >>> 0).toString(16);
}

function highlight(el) {
  el.classList.add("highlight");
  if (highlightTimeouts.has(el)) clearTimeout(highlightTimeouts.get(el));
  const t = setTimeout(() => el.classList.remove("highlight"), 1500);
  highlightTimeouts.set(el, t);
  // 滚动到可视区域
  el.scrollIntoView({ behavior: "smooth", block: "center" });
}

// 初始化
ensurePanel();
initObserver();