// content script：在面板顶部新增手动输入框，可自定义句子解析
const TARGET_CLASS_PART = "_2jz5U"; // Duolingo 正确答案节点 class 片段（需要时更新）
const PANEL_ID = "duolingo-deepseek-panel";

let observing = false;
let enableMarkdown = true;
let autoExplain = false;
const seenSentences = new Set(); // 已出现的句子（包含手动与自动）
const highlightTimeouts = new Map();

chrome.storage.sync.get(["enableMarkdown", "autoExplain"], cfg => {
  if (cfg.enableMarkdown !== undefined) enableMarkdown = cfg.enableMarkdown;
  autoExplain = cfg.autoExplain === true;
});

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.innerHTML = `
      <div class="ddp-header">
        <span>Deepseek 解析</span>
        <button id="ddp-close-btn" title="关闭">×</button>
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
    `;
    document.body.appendChild(panel);
    document.getElementById("ddp-close-btn").addEventListener("click", () => {
      panel.style.display = "none";
    });

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
    if (autoStart && existing.querySelector(".ddp-explanation-block")?.style.display !== "block") {
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
    <div class="ddp-explanation-block" style="display:none;"></div>
  `;

  const explainBtn = container.querySelector(".ddp-explain-btn");
  const regenBtn = container.querySelector(".ddp-regenerate-btn");
  const statusEl = container.querySelector(".ddp-status");
  const blockEl = container.querySelector(".ddp-explanation-block");

  explainBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: true });
  });

  regenBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: false, regenerate: true });
  });

  list.prepend(container);
  ensurePanel().style.display = "flex";
  highlight(container);

  if (autoStart) {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: true });
  }

  return container;
}

function requestExplanation(sentence, ctx) {
  const { statusEl, blockEl, explainBtn, regenBtn } = ctx;
  statusEl.innerHTML = `<span class="spinner"></span> 正在请求...`;
  blockEl.style.display = "none";
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
        blockEl.innerHTML = html;
        blockEl.style.display = "block";
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
    // 如果已经有解析，则不自动请求（上面 addCandidate 会自动请求 only when autoStart true; we decide logic)
    // 这里逻辑：若已有解析就不重复请求；如果没有解析（状态区为空），按钮会被自动点击
    const blockEl = candidate.querySelector(".ddp-explanation-block");
    if (blockEl && blockEl.style.display === "block") {
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
        node.querySelectorAll?.(`div[class*="${TARGET_CLASS_PART}"]`)?.forEach(checkNode);
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
  if (!node.className.includes(TARGET_CLASS_PART)) return;
  const text = node.textContent?.trim();
  if (text && !seenSentences.has(text) && isLikelyValidSentence(text)) {
    seenSentences.add(text);
    addCandidate(text, { autoStart: autoExplain, manual: false });
  }
}

function isLikelyValidSentence(text) {
  if (text.length < 2) return false;
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