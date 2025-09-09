// 读取/保存设置（新增 autoExplain）
const els = {
  apiKey: document.getElementById("apiKey"),
  systemPrompt: document.getElementById("systemPrompt"),
  userPrompt: document.getElementById("userPrompt"),
  model: document.getElementById("model"),
  temperature: document.getElementById("temperature"),
  enableMarkdown: document.getElementById("enableMarkdown"),
  autoExplain: document.getElementById("autoExplain"),
  saveBtn: document.getElementById("saveBtn"),
  restoreBtn: document.getElementById("restoreBtn"),
  msg: document.getElementById("msg")
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

// 加载
chrome.storage.sync.get([
  "deepseekApiKey",
  "systemPrompt",
  "userPrompt",
  "model",
  "temperature",
  "enableMarkdown",
  "autoExplain"
], (cfg) => {
  els.apiKey.value = cfg.deepseekApiKey || "";
  els.systemPrompt.value = cfg.systemPrompt || "";
  els.userPrompt.value = cfg.userPrompt || "";
  els.model.value = cfg.model || "deepseek-chat";
  els.temperature.value = (cfg.temperature !== undefined ? cfg.temperature : 0.4);
  els.enableMarkdown.checked = cfg.enableMarkdown !== false;
  els.autoExplain.checked = cfg.autoExplain === true; // 默认 false
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
    autoExplain: els.autoExplain.checked
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