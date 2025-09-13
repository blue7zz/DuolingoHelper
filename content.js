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
    <div class="ddp-wrong-answer-section">
      <div class="ddp-wrong-answer-input-container">
        <input class="ddp-wrong-answer-input" type="text" placeholder="输入你的错误答案..." />
        <button class="ddp-save-wrong-btn">保存错误答案</button>
      </div>
      <div class="ddp-wrong-answer-status"></div>
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
        <div class="ddp-followup-history"></div>
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
  const followupHistory = container.querySelector(".ddp-followup-history");
  const wrongAnswerInput = container.querySelector(".ddp-wrong-answer-input");
  const saveWrongBtn = container.querySelector(".ddp-save-wrong-btn");
  const wrongAnswerStatus = container.querySelector(".ddp-wrong-answer-status");

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
    requestFollowup(sentence, question, { followupStatus, followupHistory, followupInput, contentEl });
  });

  followupInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      followupBtn.click();
    }
  });

  // Wrong answer functionality
  saveWrongBtn.addEventListener("click", () => {
    const wrongAnswer = wrongAnswerInput.value.trim();
    if (wrongAnswer.length < 1) {
      wrongAnswerInput.focus();
      return;
    }
    saveWrongAnswer(sentence, wrongAnswer, wrongAnswerStatus, wrongAnswerInput);
  });

  wrongAnswerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      saveWrongBtn.click();
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
  const { followupStatus, followupHistory, followupInput, contentEl } = ctx;
  
  followupStatus.innerHTML = `<span class="spinner"></span> 正在追问...`;
  
  // Get the original explanation content
  const originalExplanation = contentEl.textContent || contentEl.innerText || "";
  
  // Get all previous followup history for context
  const previousFollowups = [];
  const existingItems = followupHistory.querySelectorAll('.ddp-followup-item');
  existingItems.forEach(item => {
    const question = item.querySelector('.ddp-followup-question')?.textContent || '';
    const answer = item.querySelector('.ddp-followup-answer')?.textContent || item.querySelector('.ddp-followup-answer')?.innerText || '';
    if (question && answer) {
      previousFollowups.push({ question, answer });
    }
  });
  
  chrome.runtime.sendMessage(
    { 
      type: "DEEPSEEK_FOLLOWUP", 
      originalSentence,
      originalExplanation,
      followupQuestion,
      previousFollowups
    },
    (resp) => {
      if (!resp) {
        followupStatus.innerHTML = `<span class="ddp-error">无响应（权限或后台异常）</span>`;
        return;
      }
      if (resp.ok) {
        followupStatus.textContent = "追问完成";
        
        // Create a new followup item
        const followupItem = document.createElement('div');
        followupItem.className = 'ddp-followup-item';
        
        const questionDiv = document.createElement('div');
        questionDiv.className = 'ddp-followup-question';
        questionDiv.textContent = `Q: ${followupQuestion}`;
        
        const answerDiv = document.createElement('div');
        answerDiv.className = 'ddp-followup-answer';
        const html = enableMarkdown ? simpleMarkdown(resp.explanation)
          : `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(resp.explanation)}</pre>`;
        answerDiv.innerHTML = `<strong>A:</strong> ${html}`;
        
        // Enhance answer content with phonetic symbol play buttons
        enhanceContentWithPhoneticButtons(answerDiv);
        
        followupItem.appendChild(questionDiv);
        followupItem.appendChild(answerDiv);
        
        // Add to history
        followupHistory.appendChild(followupItem);
        followupHistory.style.display = "block";
        
        followupInput.value = ""; // Clear the input
        
        // Scroll the new item into view
        followupItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
        
        // Enhance content with phonetic symbol play buttons
        enhanceContentWithPhoneticButtons(contentEl);
        
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

// 错误答案相关功能
async function saveWrongAnswer(correctSentence, wrongAnswer, statusEl, inputEl) {
  try {
    statusEl.innerHTML = `<span class="spinner"></span> 保存中...`;
    
    await recordWrongAnswer(correctSentence, wrongAnswer);
    
    statusEl.innerHTML = `<span style="color: #16a34a;">已保存错误答案</span>`;
    inputEl.value = "";
    
    setTimeout(() => {
      statusEl.innerHTML = "";
    }, 3000);
  } catch (error) {
    console.error("保存错误答案失败:", error);
    statusEl.innerHTML = `<span style="color: #ef4444;">保存失败</span>`;
    
    setTimeout(() => {
      statusEl.innerHTML = "";
    }, 3000);
  }
}

async function recordWrongAnswer(correctSentence, wrongAnswer) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["wrongAnswers"], (result) => {
      const wrongAnswers = result.wrongAnswers || [];
      
      wrongAnswers.push({
        id: hash(correctSentence + wrongAnswer + Date.now()),
        correctSentence,
        wrongAnswer,
        timestamp: new Date().toISOString()
      });
      
      chrome.storage.sync.set({ wrongAnswers: wrongAnswers }, resolve);
    });
  });
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

// Phonetic symbol detection and enhancement
function detectPhoneticSymbols(htmlContent) {
  // IPA symbols and common phonetic patterns
  const phoneticRegex = /[\[\uFF3B\/]([ɪɛæɑɔʊʌəɚɝθðʃʒŋtʃdʒjwɹlmnpbtkgfvszh\s'ˈˌːˑ\u02C8\u02CC\u02D0\u02D1]+)[\]\uFF3D\/]/g;
  
  const matches = [];
  let match;
  
  // Create a temporary div to parse HTML safely
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Get text content to search for phonetic symbols
  const textContent = tempDiv.textContent || tempDiv.innerText;
  
  while ((match = phoneticRegex.exec(textContent)) !== null) {
    // Validate that this contains actual IPA symbols
    const phoneticText = match[1];
    if (containsIpaSymbols(phoneticText)) {
      matches.push({
        fullMatch: match[0],
        phoneticText: phoneticText,
        index: match.index
      });
    }
  }
  
  return matches;
}

function containsIpaSymbols(text) {
  // Check if text contains actual IPA symbols (not just regular letters)
  const ipaSymbols = /[ɪɛæɑɔʊʌəɚɝθðʃʒŋtʃdʒɹˈˌːˑ\u02C8\u02CC\u02D0\u02D1]/;
  return ipaSymbols.test(text);
}

function cleanPhoneticText(phoneticText) {
  // Remove surrounding brackets first
  let cleaned = phoneticText
    .replace(/[\[\]\uFF3B\uFF3D\/]/g, '') // Remove brackets
    .trim();
    
  // Convert IPA symbols to more TTS-friendly approximations
  cleaned = convertIpaToTtsFriendly(cleaned);
  
  return cleaned;
}

// Convert IPA symbols to TTS-friendly approximations
function convertIpaToTtsFriendly(ipaText) {
  // Create a mapping from IPA symbols to TTS-friendly approximations
  const ipaToTtsMap = {
    // Vowels - 元音
    'ɪ': 'i',      // near-close near-front unrounded vowel (bit)
    'ɛ': 'e',      // open-mid front unrounded vowel (bet)
    'æ': 'a',      // near-open front unrounded vowel (bat)
    'ɑ': 'a',      // open back unrounded vowel (father)
    'ɔ': 'o',      // open-mid back rounded vowel (caught)
    'ʊ': 'u',      // near-close near-back rounded vowel (book)
    'ʌ': 'u',      // open-mid back unrounded vowel (but)
    'ə': 'uh',     // mid central vowel (schwa - about)
    'ɚ': 'er',     // mid central vowel with r-coloring (butter)
    'ɝ': 'er',     // mid central vowel with r-coloring (bird)
    
    // Consonants - 辅音
    'θ': 'th',     // voiceless dental fricative (think)
    'ð': 'th',     // voiced dental fricative (this) 
    'ʃ': 'sh',     // voiceless postalveolar fricative (ship)
    'ʒ': 'zh',     // voiced postalveolar fricative (measure)
    'ŋ': 'ng',     // velar nasal (sing)
    'tʃ': 'ch',    // voiceless postalveolar affricate (chip)
    'dʒ': 'j',     // voiced postalveolar affricate (jump)
    'ɹ': 'r',      // alveolar approximant (red)
    
    // Diphthongs - 双元音
    'eɪ': 'ay',    // face
    'aɪ': 'eye',   // price
    'ɔɪ': 'oy',    // choice
    'aʊ': 'ow',    // mouth
    'oʊ': 'oh',    // goat
    'ɪə': 'eer',   // near
    'ɛə': 'air',   // square
    'ʊə': 'oor',   // cure
    
    // Stress and length markers - remove these
    'ˈ': '',       // primary stress
    'ˌ': '',       // secondary stress  
    'ː': '',       // length marker
    'ˑ': '',       // half-length marker
    '\u02C8': '',  // primary stress (unicode)
    '\u02CC': '',  // secondary stress (unicode)
    '\u02D0': '',  // length marker (unicode)
    '\u02D1': ''   // half-length marker (unicode)
  };
  
  let result = ipaText;
  
  // Apply mappings in order (longer patterns first to avoid partial matches)
  const sortedKeys = Object.keys(ipaToTtsMap).sort((a, b) => b.length - a.length);
  
  for (const ipaSymbol of sortedKeys) {
    const replacement = ipaToTtsMap[ipaSymbol];
    const regex = new RegExp(escapeRegExp(ipaSymbol), 'g');
    result = result.replace(regex, replacement);
  }
  
  // Clean up any remaining special characters and normalize spaces
  result = result
    .replace(/[^a-zA-Z\s]/g, '') // Remove any remaining non-alphabetic chars except spaces
    .replace(/\s+/g, ' ')        // Normalize multiple spaces
    .trim();
    
  return result;
}

// Helper function to escape special regex characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function playPhoneticSymbol(phoneticText, playBtn) {
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

  // Clean and convert the phonetic text for better TTS
  const cleanedText = cleanPhoneticText(phoneticText);
  
  // If the cleaned text is empty or very short, fall back to a more literal approach
  const textToSpeak = cleanedText.length < 2 ? phoneticText.replace(/[\[\]\/]/g, '') : cleanedText;
  
  console.log(`音标播放: 原始="${phoneticText}" -> 清理后="${textToSpeak}"`);
  
  const utterance = new SpeechSynthesisUtterance(textToSpeak);
  
  // Configure utterance with optimal settings for phonetic pronunciation
  utterance.rate = ttsConfig.rate * 0.7; // Even slower for better clarity
  utterance.pitch = ttsConfig.pitch * 0.9; // Slightly lower pitch for clarity
  utterance.volume = ttsConfig.volume;

  // Try to select the best English voice for phonetic symbols
  const voice = selectBestVoiceForPhonetics();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang;
  } else {
    // Fallback to generic English
    utterance.lang = 'en-US';
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
    resetPhoneticPlayButton(playBtn, phoneticText);
  };

  utterance.onerror = (event) => {
    console.warn('Phonetic text-to-speech error:', event.error);
    resetPhoneticPlayButton(playBtn, phoneticText);
  };

  // Start speaking
  speechSynthesis.speak(utterance);
}

// Select the best voice specifically for phonetic pronunciation
function selectBestVoiceForPhonetics() {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Preferred voice characteristics for phonetic pronunciation
  const preferences = [
    // High-quality English voices (often better for phonetics)
    { pattern: /microsoft.*david/i, lang: 'en-US' },
    { pattern: /microsoft.*zira/i, lang: 'en-US' },
    { pattern: /google.*english/i, lang: 'en-US' },
    { pattern: /enhanced/i, lang: 'en-US' },
    { pattern: /premium/i, lang: 'en-US' },
    { pattern: /neural/i, lang: 'en-US' },
    // Fallback to any US English voice
    { pattern: /./i, lang: 'en-US' },
    { pattern: /./i, lang: 'en-GB' },
    { pattern: /./i, lang: 'en' }
  ];

  // First check if user has a preferred voice that works
  if (ttsConfig.preferredVoice) {
    const preferredVoice = voices.find(v => v.name === ttsConfig.preferredVoice && v.lang.startsWith('en'));
    if (preferredVoice) return preferredVoice;
  }

  // Try each preference in order
  for (const pref of preferences) {
    const voice = voices.find(v => 
      v.lang.startsWith(pref.lang) && pref.pattern.test(v.name)
    );
    if (voice) return voice;
  }

  // Final fallback
  return voices.find(v => v.lang.startsWith('en')) || voices[0];
}

function resetPhoneticPlayButton(playBtn, phoneticText) {
  playBtn.disabled = false;
  playBtn.textContent = "🔊";
  playBtn.title = "播放音标";
  playBtn.onclick = () => {
    playPhoneticSymbol(phoneticText, playBtn);
  };
}

function enhanceContentWithPhoneticButtons(contentElement) {
  if (!contentElement) return;
  
  // Get the HTML content
  const htmlContent = contentElement.innerHTML;
  
  // Detect phonetic symbols
  const phoneticMatches = detectPhoneticSymbols(htmlContent);
  
  if (phoneticMatches.length === 0) return; // No phonetic symbols found
  
  // Create a document fragment to work with
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlContent;
  
  // Process each text node to find and replace phonetic symbols
  const walker = document.createTreeWalker(
    tempDiv,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  // Process text nodes in reverse order to maintain indices
  for (let i = textNodes.length - 1; i >= 0; i--) {
    const textNode = textNodes[i];
    const text = textNode.textContent;
    
    // Find phonetic symbols in this text node
    const phoneticRegex = /[\[\uFF3B\/]([ɪɛæɑɔʊʌəɚɝθðʃʒŋtʃdʒjwɹlmnpbtkgfvszh\s'ˈˌːˑ\u02C8\u02CC\u02D0\u02D1]+)[\]\uFF3D\/]/g;
    let match;
    const replacements = [];
    
    while ((match = phoneticRegex.exec(text)) !== null) {
      if (containsIpaSymbols(match[1])) {
        replacements.push({
          start: match.index,
          end: match.index + match[0].length,
          phoneticText: match[1],
          fullMatch: match[0]
        });
      }
    }
    
    if (replacements.length > 0) {
      // Create replacement HTML
      let newHTML = text;
      
      // Process replacements in reverse order to maintain indices
      for (let j = replacements.length - 1; j >= 0; j--) {
        const replacement = replacements[j];
        const phoneticSpan = `<span class="ddp-phonetic-symbol">
          <span class="ddp-phonetic-text">${escapeHtml(replacement.fullMatch)}</span>
          <button class="ddp-phonetic-play-btn" title="播放音标" data-phonetic="${escapeHtml(replacement.phoneticText)}">🔊</button>
        </span>`;
        
        newHTML = newHTML.slice(0, replacement.start) + phoneticSpan + newHTML.slice(replacement.end);
      }
      
      // Replace the text node with new HTML
      const wrapper = document.createElement('span');
      wrapper.innerHTML = newHTML;
      textNode.parentNode.replaceChild(wrapper, textNode);
    }
  }
  
  // Update the content element
  contentElement.innerHTML = tempDiv.innerHTML;
  
  // Bind click events to phonetic play buttons
  const phoneticPlayBtns = contentElement.querySelectorAll('.ddp-phonetic-play-btn');
  phoneticPlayBtns.forEach(btn => {
    const phoneticText = btn.getAttribute('data-phonetic');
    btn.onclick = () => {
      playPhoneticSymbol(phoneticText, btn);
    };
  });
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