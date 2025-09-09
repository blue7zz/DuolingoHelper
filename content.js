// content script：在面板顶部新增手动输入框，可自定义句子解析
let TARGET_CLASS_FRAGMENTS = ["_2jz5U"]; // 可配置的 class 片段列表，默认值
const PANEL_ID = "duolingo-deepseek-panel";

let observing = false;
let enableMarkdown = true;
let autoExplain = false;
const seenSentences = new Set(); // 已出现的句子（包含手动与自动）
const highlightTimeouts = new Map();

// Text-to-speech configuration and state
let ttsConfig = {
  enabled: true,
  rate: 1.0,
  pitch: 1.0,
  volume: 0.8,
  preferredVoice: null
};

// Load TTS configuration
chrome.storage.sync.get(["ttsConfig"], cfg => {
  if (cfg.ttsConfig) {
    ttsConfig = { ...ttsConfig, ...cfg.ttsConfig };
  }
});

// Text-to-speech functionality
function playTextToSpeech(text, playBtn) {
  if (!ttsConfig.enabled) {
    return;
  }

  // Check if speech synthesis is supported
  if (!('speechSynthesis' in window)) {
    console.warn('Text-to-speech not supported in this browser');
    return;
  }

  // Stop any ongoing speech
  speechSynthesis.cancel();

  // Update button state
  playBtn.disabled = true;
  playBtn.textContent = "🔊";
  playBtn.title = "播放中...";

  const utterance = new SpeechSynthesisUtterance(text);
  
  // Configure utterance
  utterance.rate = ttsConfig.rate;
  utterance.pitch = ttsConfig.pitch;
  utterance.volume = ttsConfig.volume;

  // Try to select appropriate voice based on language detection
  const detectedLang = detectLanguage(text);
  const voice = selectBestVoice(detectedLang);
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  }

  // Event handlers
  utterance.onstart = () => {
    playBtn.textContent = "⏸️";
    playBtn.title = "播放中 (点击停止)";
    playBtn.onclick = () => {
      speechSynthesis.cancel();
    };
  };

  utterance.onend = () => {
    resetPlayButton(playBtn, text);
  };

  utterance.onerror = (event) => {
    console.warn('Text-to-speech error:', event.error);
    resetPlayButton(playBtn, text);
  };

  // Start speaking
  speechSynthesis.speak(utterance);
}

function resetPlayButton(playBtn, text) {
  playBtn.disabled = false;
  playBtn.textContent = "🔊";
  playBtn.title = "播放语音";
  playBtn.onclick = () => {
    playTextToSpeech(text, playBtn);
  };
}

// Language detection function (copied from background.js)
function detectLanguage(text) {
  // 简单判断：包含汉字范围
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  // 含大量拉丁字母 + 空格
  if (/^[A-Za-z0-9 ,.'";:!?()-]+$/.test(text)) return "English/Latin-like";
  if (/[áéíóúñ¿¡]/i.test(text)) return "Spanish-like";
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return "French-like";
  return "Unknown";
}

function selectBestVoice(detectedLang) {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Language preferences mapping
  const langMap = {
    'English/Latin-like': ['en-US', 'en-GB', 'en'],
    'Spanish-like': ['es-ES', 'es-US', 'es'],
    'French-like': ['fr-FR', 'fr'],
    'Chinese': ['zh-CN', 'zh-TW', 'zh'],
    'Unknown': ['en-US', 'en']
  };

  const preferredLangs = langMap[detectedLang] || ['en-US', 'en'];
  
  // First try to find user's preferred voice if set
  if (ttsConfig.preferredVoice) {
    const preferredVoice = voices.find(v => v.name === ttsConfig.preferredVoice);
    if (preferredVoice) return preferredVoice;
  }

  // Try to find the best voice for detected language
  for (const lang of preferredLangs) {
    // Look for neural or premium voices first
    const neuralVoice = voices.find(v => 
      v.lang.startsWith(lang) && 
      (v.name.includes('Neural') || v.name.includes('Premium') || v.name.includes('Enhanced'))
    );
    if (neuralVoice) return neuralVoice;

    // Fall back to any voice for this language
    const anyVoice = voices.find(v => v.lang.startsWith(lang));
    if (anyVoice) return anyVoice;
  }

  // Final fallback to default voice
  return voices[0];
}

// 加载配置
chrome.storage.sync.get(["enableMarkdown", "autoExplain", "customClassFragments", "ttsConfig"], cfg => {
  if (cfg.enableMarkdown !== undefined) enableMarkdown = cfg.enableMarkdown;
  autoExplain = cfg.autoExplain === true;
  
  // Load TTS configuration
  if (cfg.ttsConfig) {
    ttsConfig = { ...ttsConfig, ...cfg.ttsConfig };
  }
  
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
    <div class="ddp-sentence">
      ${escapeHtml(sentence)}
      <button class="ddp-play-btn" title="播放语音">🔊</button>
    </div>
    <div class="ddp-actions">
      <button class="ddp-explain-btn">解析</button>
      <button class="ddp-regenerate-btn" style="display:none;">重新生成</button>
      <button class="ddp-record-btn" title="记录此问题">记录</button>
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
  const recordBtn = container.querySelector(".ddp-record-btn");
  const playBtn = container.querySelector(".ddp-play-btn");
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

  recordBtn.addEventListener("click", () => {
    toggleRecordProblem(sentence, contentEl, recordBtn, container);
  });

  playBtn.addEventListener("click", () => {
    playTextToSpeech(sentence, playBtn);
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

  // 检查并更新记录状态
  checkAndUpdateRecordStatus(sentence, recordBtn, container);

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
  const { container, statusEl, blockEl, contentEl, followupEl, explainBtn, regenBtn } = ctx;
  const recordBtn = container?.querySelector(".ddp-record-btn");
  
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
        
        // Update record button state if it exists
        if (recordBtn && container) {
          checkAndUpdateRecordStatus(sentence, recordBtn, container);
        }
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

// 记录问题相关功能
async function toggleRecordProblem(sentence, contentEl, recordBtn, container) {
  const explanation = contentEl.textContent || contentEl.innerText || "";
  
  if (!explanation.trim()) {
    recordBtn.title = "请先获取解析再记录";
    // Add visual feedback
    recordBtn.style.background = "#f59e0b";
    recordBtn.textContent = "先解析";
    setTimeout(() => {
      recordBtn.style.background = "";
      recordBtn.textContent = "记录";
    }, 2000);
    return;
  }

  try {
    const isRecorded = await isQuestionRecorded(sentence);
    
    if (isRecorded) {
      await unrecordQuestion(sentence);
      updateRecordButtonState(recordBtn, container, false);
    } else {
      await recordQuestion(sentence, explanation);
      updateRecordButtonState(recordBtn, container, true);
    }
  } catch (error) {
    console.error("记录操作失败:", error);
  }
}

async function recordQuestion(sentence, explanation) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["recordedProblems"], (result) => {
      const problems = result.recordedProblems || [];
      const problemId = hash(sentence);
      
      // 检查是否已存在
      const existing = problems.find(p => p.id === problemId);
      if (existing) {
        resolve();
        return;
      }
      
      problems.push({
        id: problemId,
        sentence,
        explanation,
        timestamp: new Date().toISOString(),
        hash: problemId
      });
      
      chrome.storage.sync.set({ recordedProblems: problems }, resolve);
    });
  });
}

async function unrecordQuestion(sentence) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["recordedProblems"], (result) => {
      const problems = result.recordedProblems || [];
      const problemId = hash(sentence);
      const filtered = problems.filter(p => p.id !== problemId);
      
      chrome.storage.sync.set({ recordedProblems: filtered }, resolve);
    });
  });
}

async function isQuestionRecorded(sentence) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["recordedProblems"], (result) => {
      const problems = result.recordedProblems || [];
      const problemId = hash(sentence);
      const exists = problems.some(p => p.id === problemId);
      resolve(exists);
    });
  });
}

function updateRecordButtonState(recordBtn, container, isRecorded) {
  if (isRecorded) {
    recordBtn.textContent = "已记录";
    recordBtn.title = "点击取消记录";
    recordBtn.classList.add("recorded");
    container.classList.add("recorded-item");
  } else {
    recordBtn.textContent = "记录";
    recordBtn.title = "记录此问题";
    recordBtn.classList.remove("recorded");
    container.classList.remove("recorded-item");
  }
}

async function checkAndUpdateRecordStatus(sentence, recordBtn, container) {
  const isRecorded = await isQuestionRecorded(sentence);
  updateRecordButtonState(recordBtn, container, isRecorded);
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

// Initialize TTS voices
function initializeTTS() {
  if ('speechSynthesis' in window) {
    // Load voices if not already loaded
    let voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        voices = speechSynthesis.getVoices();
        console.log('TTS voices loaded:', voices.length);
      });
    }
  }
}

// 初始化
ensurePanel();
initObserver();
initializeTTS();