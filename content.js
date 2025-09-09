// content script：在面板顶部新增手动输入框，可自定义句子解析
let TARGET_CLASS_FRAGMENTS = ["_2jz5U"]; // 可配置的 class 片段列表，默认值
const PANEL_ID = "duolingo-deepseek-panel";

let observing = false;
let enableMarkdown = true;
let autoExplain = false;
const seenSentences = new Set(); // 已出现的句子（包含手动与自动）
const highlightTimeouts = new Map();

// History management
let historyItems = []; // 历史记录缓存

// 加载配置
chrome.storage.sync.get(["enableMarkdown", "autoExplain", "customClassFragments"], cfg => {
  if (cfg.enableMarkdown !== undefined) enableMarkdown = cfg.enableMarkdown;
  autoExplain = cfg.autoExplain === true;
  
  // 加载自定义 class 片段
  if (cfg.customClassFragments && cfg.customClassFragments.length > 0) {
    TARGET_CLASS_FRAGMENTS = [...cfg.customClassFragments];
  }
});

// 加载历史记录
chrome.storage.local.get(["duolingoHistory"], (result) => {
  historyItems = result.duolingoHistory || [];
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
      <button class="ddp-bookmark-btn" title="收藏到历史记录">★</button>
    </div>
    <div class="ddp-status"></div>
    <div class="ddp-explanation-block" style="display:none;"></div>
    <div class="ddp-followup-section" style="display:none;">
      <div class="ddp-followup-input">
        <input type="text" placeholder="继续追问..." class="ddp-followup-text" />
        <button class="ddp-followup-submit">发送</button>
      </div>
      <div class="ddp-followup-history"></div>
    </div>
  `;

  const explainBtn = container.querySelector(".ddp-explain-btn");
  const regenBtn = container.querySelector(".ddp-regenerate-btn");
  const bookmarkBtn = container.querySelector(".ddp-bookmark-btn");
  const statusEl = container.querySelector(".ddp-status");
  const blockEl = container.querySelector(".ddp-explanation-block");
  const followupSection = container.querySelector(".ddp-followup-section");
  const followupInput = container.querySelector(".ddp-followup-text");
  const followupSubmit = container.querySelector(".ddp-followup-submit");
  const followupHistory = container.querySelector(".ddp-followup-history");

  explainBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: true, followupSection });
  });

  regenBtn.addEventListener("click", () => {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: false, regenerate: true, followupSection });
  });

  bookmarkBtn.addEventListener("click", () => {
    toggleBookmark(sentence, container, bookmarkBtn);
  });

  followupSubmit.addEventListener("click", () => {
    submitFollowup(sentence, followupInput.value.trim(), followupHistory, followupInput);
  });

  followupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      followupSubmit.click();
    }
  });

  list.prepend(container);
  ensurePanel().style.display = "flex";
  highlight(container);

  // 检查收藏状态
  const historyItem = historyItems.find(h => h.sentence === sentence);
  if (historyItem && historyItem.bookmarked) {
    bookmarkBtn.textContent = "★";
    bookmarkBtn.style.color = "#fbbf24";
    bookmarkBtn.title = "已收藏";
  }

  if (autoStart) {
    requestExplanation(sentence, { container, statusEl, blockEl, explainBtn, regenBtn, first: true, followupSection });
  }

  return container;
}

function requestExplanation(sentence, ctx) {
  const { statusEl, blockEl, explainBtn, regenBtn, followupSection } = ctx;
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
        
        // 显示追问区域
        if (followupSection) {
          followupSection.style.display = "block";
        }
        
        // 保存到历史记录
        saveToHistory(sentence, resp.explanation);
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

// 保存到历史记录
function saveToHistory(sentence, explanation) {
  const id = Date.now().toString();
  const historyItem = {
    id,
    sentence,
    explanation,
    bookmarked: false,
    timestamp: new Date().toISOString(),
    followUps: []
  };
  
  historyItems.unshift(historyItem);
  // 限制历史记录数量，保留最近的500条
  if (historyItems.length > 500) {
    historyItems = historyItems.slice(0, 500);
  }
  
  chrome.storage.local.set({ duolingoHistory: historyItems });
}

// 切换收藏状态
function toggleBookmark(sentence, container, bookmarkBtn) {
  const item = historyItems.find(h => h.sentence === sentence);
  if (!item) {
    // 如果历史记录中没有这个项目，先创建一个
    saveToHistory(sentence, "");
    const newItem = historyItems.find(h => h.sentence === sentence);
    if (newItem) {
      newItem.bookmarked = true;
    }
  } else {
    item.bookmarked = !item.bookmarked;
  }
  
  chrome.storage.local.set({ duolingoHistory: historyItems });
  
  // 更新按钮显示
  const isBookmarked = item ? item.bookmarked : true;
  bookmarkBtn.textContent = isBookmarked ? "★" : "☆";
  bookmarkBtn.title = isBookmarked ? "已收藏" : "收藏到历史记录";
  
  // 添加视觉反馈
  bookmarkBtn.style.color = isBookmarked ? "#fbbf24" : "#9ca3af";
}

// 提交追问
function submitFollowup(sentence, followupQuestion, followupHistory, inputEl) {
  if (!followupQuestion) {
    inputEl.focus();
    return;
  }
  
  // 添加加载状态
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "ddp-followup-item";
  loadingDiv.innerHTML = `
    <div class="ddp-followup-question">${escapeHtml(followupQuestion)}</div>
    <div class="ddp-followup-answer"><span class="spinner"></span> 正在回答...</div>
  `;
  followupHistory.appendChild(loadingDiv);
  
  // 清空输入框
  inputEl.value = "";
  
  // 发送请求
  chrome.runtime.sendMessage(
    { 
      type: "DEEPSEEK_FOLLOWUP", 
      originalSentence: sentence,
      followupQuestion: followupQuestion 
    },
    (resp) => {
      const answerDiv = loadingDiv.querySelector(".ddp-followup-answer");
      if (!resp || !resp.ok) {
        answerDiv.innerHTML = `<span class="ddp-error">${escapeHtml(resp?.error || "请求失败")}</span>`;
        return;
      }
      
      const html = enableMarkdown ? simpleMarkdown(resp.explanation)
        : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(resp.explanation)}</pre>`;
      answerDiv.innerHTML = html;
      
      // 保存追问到历史记录
      const historyItem = historyItems.find(h => h.sentence === sentence);
      if (historyItem) {
        historyItem.followUps.push({
          question: followupQuestion,
          answer: resp.explanation,
          timestamp: new Date().toISOString()
        });
        chrome.storage.local.set({ duolingoHistory: historyItems });
      }
    }
  );
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