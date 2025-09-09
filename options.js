// 读取/保存设置（新增 autoExplain 和 customClassFragments）
const els = {
  apiKey: document.getElementById("apiKey"),
  systemPrompt: document.getElementById("systemPrompt"),
  userPrompt: document.getElementById("userPrompt"),
  model: document.getElementById("model"),
  temperature: document.getElementById("temperature"),
  enableMarkdown: document.getElementById("enableMarkdown"),
  autoExplain: document.getElementById("autoExplain"),
  enableTTS: document.getElementById("enableTTS"),
  ttsRate: document.getElementById("ttsRate"),
  ttsPitch: document.getElementById("ttsPitch"),
  ttsVolume: document.getElementById("ttsVolume"),
  ttsPreferredVoice: document.getElementById("ttsPreferredVoice"),
  testTTSBtn: document.getElementById("testTTSBtn"),
  saveBtn: document.getElementById("saveBtn"),
  restoreBtn: document.getElementById("restoreBtn"),
  msg: document.getElementById("msg"),
  classFragments: document.getElementById("classFragments"),
  newClassFragment: document.getElementById("newClassFragment"),
  addFragmentBtn: document.getElementById("addFragmentBtn"),
  exportProblemsBtn: document.getElementById("exportProblemsBtn"),
  clearProblemsBtn: document.getElementById("clearProblemsBtn"),
  problemsCount: document.getElementById("problemsCount"),
  recordedProblemsList: document.getElementById("recordedProblemsList")
};

const DEFAULT_SYSTEM_PROMPT = `你是一个专业的语言学习助手。请遵守：
1. 解释简洁分层。
2. 先给出自然翻译，再做结构剖析。
3. 避免冗长无关寒暄。
4. 使用合适的 Markdown 层次。`;

const DEFAULT_USER_PROMPT = `请针对下列句子输出：
A. 直接翻译
B. 逐词 / 短语讲解
C. 语法点（若有）
D. 词汇扩展（3~5个相关词）
E. 2 个相似例句（含翻译）
F. 学习提示（短）

句子：{{sentence}}
检测语言：{{languageDetected}}
长度：{{sentenceLength}}
当前时间：{{now}}`;

const PRESETS = {
  explain: {
    system: DEFAULT_SYSTEM_PROMPT,
    user: DEFAULT_USER_PROMPT
  },
  compare: {
    system: `你是一个对比型语言导师，强调差异、细微语感和使用场景。`,
    user: `请对句子：{{sentence}}
1. 翻译
2. 关键词 + 词性 + 简洁含义
3. 3 组近义/易混表达对比（含差异说明）
4. 常见错误示例并纠正
5. 学习建议一句话`
  },
  mnemonic: {
    system: `你是语言记忆策略教练，擅长联想/图像记忆。`,
    user: `目标句子：{{sentence}}
请给出：
1. 翻译
2. 关键词拆分
3. 一个短记忆联想故事 (<60字)
4. 语法或结构提醒
5. 复习时间建议`
  },
  grammarFocus: {
    system: `你是语法教学助理。`,
    user: `句子：{{sentence}}
任务：
1. 翻译
2. 主干 (S / V / O)
3. 从句 / 短语标注
4. 关键语法点列表
5. 两个替换变式
6. 常见错误警示`
  },
  translationQuiz: {
    system: `你是一个互动式语言训练助手。`,
    user: `给定句子：{{sentence}}
流程：
1. 含义提示（不完整翻译）
2. 让学习者尝试翻译（指令）
3. 标准翻译
4. 3 个常见错误
5. 延伸练习（变换时态或否定）`
  }
};

// TTS related functions
function loadTTSVoices() {
  if (!('speechSynthesis' in window)) {
    els.ttsPreferredVoice.innerHTML = '<option value="">语音播放不支持</option>';
    return;
  }

  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) {
    els.ttsPreferredVoice.innerHTML = '<option value="">正在加载语音...</option>';
    return;
  }

  els.ttsPreferredVoice.innerHTML = '<option value="">自动选择</option>';
  
  // Group voices by language
  const voicesByLang = {};
  voices.forEach(voice => {
    const lang = voice.lang.split('-')[0];
    if (!voicesByLang[lang]) voicesByLang[lang] = [];
    voicesByLang[lang].push(voice);
  });

  // Add voices organized by language
  Object.keys(voicesByLang).sort().forEach(lang => {
    const langName = {
      'en': 'English',
      'zh': '中文',
      'es': 'Español',
      'fr': 'Français',
      'de': 'Deutsch',
      'ja': '日本語',
      'ko': '한국어',
      'it': 'Italiano',
      'pt': 'Português',
      'ru': 'Русский'
    }[lang] || lang.toUpperCase();

    const optgroup = document.createElement('optgroup');
    optgroup.label = langName;
    
    voicesByLang[lang].forEach(voice => {
      const option = document.createElement('option');
      option.value = voice.name;
      option.textContent = `${voice.name} (${voice.lang})`;
      optgroup.appendChild(option);
    });
    
    els.ttsPreferredVoice.appendChild(optgroup);
  });
}

function testTTS() {
  if (!('speechSynthesis' in window)) {
    showMsg("此浏览器不支持语音播放", "#dc2626");
    return;
  }

  speechSynthesis.cancel();

  const testText = "Hello, this is a test of the text-to-speech functionality. 你好，这是语音播放功能的测试。";
  const utterance = new SpeechSynthesisUtterance(testText);
  
  utterance.rate = parseFloat(els.ttsRate.value) || 1.0;
  utterance.pitch = parseFloat(els.ttsPitch.value) || 1.0;
  utterance.volume = parseFloat(els.ttsVolume.value) || 0.8;

  if (els.ttsPreferredVoice.value) {
    const voices = speechSynthesis.getVoices();
    const selectedVoice = voices.find(v => v.name === els.ttsPreferredVoice.value);
    if (selectedVoice) {
      utterance.voice = selectedVoice;
      utterance.lang = selectedVoice.lang;
    }
  }

  utterance.onstart = () => {
    els.testTTSBtn.disabled = true;
    els.testTTSBtn.textContent = "播放中...";
  };

  utterance.onend = () => {
    els.testTTSBtn.disabled = false;
    els.testTTSBtn.textContent = "测试语音";
    showMsg("语音测试完成", "#16a34a");
  };

  utterance.onerror = (event) => {
    els.testTTSBtn.disabled = false;
    els.testTTSBtn.textContent = "测试语音";
    showMsg("语音播放出错: " + event.error, "#dc2626");
  };

  speechSynthesis.speak(utterance);
  showMsg("开始播放测试语音...", "#2563eb");
}

// 默认 class 片段
const DEFAULT_CLASS_FRAGMENTS = ["_2jz5U"];

// 当前的 class 片段列表
let currentClassFragments = [...DEFAULT_CLASS_FRAGMENTS];

// 渲染 class 片段列表
function renderClassFragments() {
  if (currentClassFragments.length === 0) {
    els.classFragments.innerHTML = '<div class="class-fragments-empty">暂无自定义 class 片段</div>';
    return;
  }
  
  els.classFragments.innerHTML = currentClassFragments.map((fragment, index) => `
    <div class="class-fragment-item">
      <code>${escapeHtml(fragment)}</code>
      <button onclick="removeClassFragment(${index})" title="删除">删除</button>
    </div>
  `).join('');
}

// 添加 class 片段
function addClassFragment() {
  const fragment = els.newClassFragment.value.trim();
  if (!fragment) {
    els.newClassFragment.focus();
    return;
  }
  
  if (currentClassFragments.includes(fragment)) {
    showMsg("该 class 片段已存在", "#dc2626");
    els.newClassFragment.select();
    return;
  }
  
  currentClassFragments.push(fragment);
  els.newClassFragment.value = "";
  renderClassFragments();
  showMsg("已添加 class 片段（记得保存）", "#16a34a");
}

// 删除 class 片段
function removeClassFragment(index) {
  if (index >= 0 && index < currentClassFragments.length) {
    const removed = currentClassFragments.splice(index, 1)[0];
    renderClassFragments();
    showMsg(`已删除 class 片段: ${removed}（记得保存）`, "#dc2626");
  }
}

// 转义 HTML
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// 记录问题相关功能
let currentRecordedProblems = [];

// 渲染记录的问题列表
function renderRecordedProblems() {
  if (currentRecordedProblems.length === 0) {
    els.recordedProblemsList.innerHTML = '<div class="recorded-problems-empty">暂无记录的问题</div>';
    els.problemsCount.textContent = '共 0 条记录';
    return;
  }
  
  els.problemsCount.textContent = `共 ${currentRecordedProblems.length} 条记录`;
  
  els.recordedProblemsList.innerHTML = currentRecordedProblems.map((problem, index) => `
    <div class="recorded-problem-item">
      <div class="recorded-problem-sentence">${escapeHtml(problem.sentence)}</div>
      <div class="recorded-problem-explanation">${escapeHtml(problem.explanation)}</div>
      <div class="recorded-problem-meta">
        <span>记录时间: ${new Date(problem.timestamp).toLocaleString('zh-CN')}</span>
        <button class="recorded-problem-delete" onclick="deleteRecordedProblem(${index})" title="删除此记录">删除</button>
      </div>
    </div>
  `).join('');
}

// 加载记录的问题
function loadRecordedProblems() {
  chrome.storage.sync.get(["recordedProblems"], (result) => {
    currentRecordedProblems = result.recordedProblems || [];
    renderRecordedProblems();
  });
}

// 删除单个记录的问题
function deleteRecordedProblem(index) {
  if (index >= 0 && index < currentRecordedProblems.length) {
    const deleted = currentRecordedProblems.splice(index, 1)[0];
    chrome.storage.sync.set({ recordedProblems: [...currentRecordedProblems] }, () => {
      renderRecordedProblems();
      showMsg(`已删除记录: ${deleted.sentence.substring(0, 20)}...`, "#dc2626");
    });
  }
}

// 导出记录的问题
function exportRecordedProblems() {
  if (currentRecordedProblems.length === 0) {
    showMsg("没有记录可以导出", "#dc2626");
    return;
  }
  
  const exportData = {
    exportTime: new Date().toISOString(),
    totalCount: currentRecordedProblems.length,
    problems: currentRecordedProblems.map(p => ({
      sentence: p.sentence,
      explanation: p.explanation,
      recordedTime: p.timestamp
    }))
  };
  
  const dataStr = JSON.stringify(exportData, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  
  const link = document.createElement('a');
  link.href = URL.createObjectURL(dataBlob);
  link.download = `duolingo-recorded-problems-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  
  showMsg(`已导出 ${currentRecordedProblems.length} 条记录`, "#16a34a");
}

// 清空所有记录
function clearAllRecordedProblems() {
  if (currentRecordedProblems.length === 0) {
    showMsg("没有记录可以清空", "#dc2626");
    return;
  }
  
  if (confirm(`确定要清空所有 ${currentRecordedProblems.length} 条记录吗？此操作不可恢复。`)) {
    chrome.storage.sync.set({ recordedProblems: [] }, () => {
      currentRecordedProblems = [];
      renderRecordedProblems();
      showMsg("已清空所有记录", "#dc2626");
    });
  }
}

// 加载
chrome.storage.sync.get([
  "deepseekApiKey",
  "systemPrompt",
  "userPrompt",
  "model",
  "temperature",
  "enableMarkdown",
  "autoExplain",
  "customClassFragments",
  "recordedProblems",
  "ttsConfig"
], (cfg) => {
  els.apiKey.value = cfg.deepseekApiKey || "";
  els.systemPrompt.value = cfg.systemPrompt || "";
  els.userPrompt.value = cfg.userPrompt || "";
  els.model.value = cfg.model || "deepseek-chat";
  els.temperature.value = (cfg.temperature !== undefined ? cfg.temperature : 0.4);
  els.enableMarkdown.checked = cfg.enableMarkdown !== false;
  els.autoExplain.checked = cfg.autoExplain === true; // 默认 false
  
  // Load TTS configuration
  const ttsConfig = cfg.ttsConfig || {};
  els.enableTTS.checked = ttsConfig.enabled !== false; // 默认 true
  els.ttsRate.value = ttsConfig.rate || 1.0;
  els.ttsPitch.value = ttsConfig.pitch || 1.0;
  els.ttsVolume.value = ttsConfig.volume || 0.8;
  
  // 加载自定义 class 片段
  currentClassFragments = cfg.customClassFragments && cfg.customClassFragments.length > 0 
    ? [...cfg.customClassFragments] 
    : [...DEFAULT_CLASS_FRAGMENTS];
  renderClassFragments();
  
  // 加载记录的问题
  currentRecordedProblems = cfg.recordedProblems || [];
  renderRecordedProblems();
  
  // Load TTS voices after a short delay to ensure they are available
  setTimeout(() => {
    loadTTSVoices();
    if (ttsConfig.preferredVoice) {
      els.ttsPreferredVoice.value = ttsConfig.preferredVoice;
    }
  }, 100);
});

// 保存
els.saveBtn.addEventListener("click", () => {
  const data = {
    deepseekApiKey: els.apiKey.value.trim(),
    systemPrompt: els.systemPrompt.value,
    userPrompt: els.userPrompt.value,
    model: els.model.value.trim() || "deepseek-chat",
    temperature: parseFloat(els.temperature.value) || 0.4,
    enableMarkdown: els.enableMarkdown.checked,
    autoExplain: els.autoExplain.checked,
    customClassFragments: [...currentClassFragments],
    ttsConfig: {
      enabled: els.enableTTS.checked,
      rate: parseFloat(els.ttsRate.value) || 1.0,
      pitch: parseFloat(els.ttsPitch.value) || 1.0,
      volume: parseFloat(els.ttsVolume.value) || 0.8,
      preferredVoice: els.ttsPreferredVoice.value || null
    }
  };
  chrome.storage.sync.set(data, () => showMsg("已保存", "green"));
});

// 恢复默认
els.restoreBtn.addEventListener("click", () => {
  els.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  els.userPrompt.value = DEFAULT_USER_PROMPT;
  showMsg("已填入默认模板（记得保存）", "#0f766e");
});

// 预设
document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.preset;
    const p = PRESETS[key];
    if (!p) return;
    els.systemPrompt.value = p.system;
    els.userPrompt.value = p.user;
    showMsg("已加载预设：" + key + "（记得保存）", "#334155");
  });
});

function showMsg(text, color) {
  els.msg.textContent = text;
  els.msg.style.color = color || "#2563eb";
  setTimeout(() => {
    if (els.msg.textContent === text) els.msg.textContent = "";
  }, 4000);
}

// 添加 class 片段事件监听
els.addFragmentBtn.addEventListener("click", addClassFragment);

// 回车快捷添加
els.newClassFragment.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    addClassFragment();
  }
});

// 将函数暴露到全局作用域，供 HTML 中的 onclick 使用
window.removeClassFragment = removeClassFragment;
window.deleteRecordedProblem = deleteRecordedProblem;

// 记录问题相关事件监听
els.exportProblemsBtn.addEventListener("click", exportRecordedProblems);
els.clearProblemsBtn.addEventListener("click", clearAllRecordedProblems);

// TTS 相关事件监听
els.testTTSBtn.addEventListener("click", testTTS);

// 语音加载事件监听
if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', loadTTSVoices);
}