// 读取/保存设置（新增 autoExplain 和 customClassFragments）
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
  msg: document.getElementById("msg"),
  classFragments: document.getElementById("classFragments"),
  newClassFragment: document.getElementById("newClassFragment"),
  addFragmentBtn: document.getElementById("addFragmentBtn"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  exportBookmarksBtn: document.getElementById("exportBookmarksBtn"),
  viewHistoryBtn: document.getElementById("viewHistoryBtn"),
  historyStats: document.getElementById("historyStats"),
  historyViewer: document.getElementById("historyViewer"),
  historyList: document.getElementById("historyList")
};

// 历史记录相关变量
let historyItems = [];
let historyVisible = false;

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

// 加载
chrome.storage.sync.get([
  "deepseekApiKey",
  "systemPrompt",
  "userPrompt",
  "model",
  "temperature",
  "enableMarkdown",
  "autoExplain",
  "customClassFragments"
], (cfg) => {
  els.apiKey.value = cfg.deepseekApiKey || "";
  els.systemPrompt.value = cfg.systemPrompt || "";
  els.userPrompt.value = cfg.userPrompt || "";
  els.model.value = cfg.model || "deepseek-chat";
  els.temperature.value = (cfg.temperature !== undefined ? cfg.temperature : 0.4);
  els.enableMarkdown.checked = cfg.enableMarkdown !== false;
  els.autoExplain.checked = cfg.autoExplain === true; // 默认 false
  
  // 加载自定义 class 片段
  currentClassFragments = cfg.customClassFragments && cfg.customClassFragments.length > 0 
    ? [...cfg.customClassFragments] 
    : [...DEFAULT_CLASS_FRAGMENTS];
  renderClassFragments();
});

// 加载历史记录
chrome.storage.local.get(["duolingoHistory"], (result) => {
  historyItems = result.duolingoHistory || [];
  updateHistoryStats();
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
    customClassFragments: [...currentClassFragments]
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

// 历史记录管理事件监听
els.clearHistoryBtn.addEventListener("click", clearAllHistory);
els.exportBookmarksBtn.addEventListener("click", exportBookmarks);
els.viewHistoryBtn.addEventListener("click", toggleHistoryViewer);

// 将函数暴露到全局作用域，供 HTML 中的 onclick 使用
window.removeClassFragment = removeClassFragment;

// 历史记录管理函数
function updateHistoryStats() {
  const total = historyItems.length;
  const bookmarked = historyItems.filter(item => item.bookmarked).length;
  const withFollowups = historyItems.filter(item => item.followUps && item.followUps.length > 0).length;
  
  els.historyStats.innerHTML = `
    总记录: <strong>${total}</strong> | 
    已收藏: <strong>${bookmarked}</strong> | 
    有追问: <strong>${withFollowups}</strong>
  `;
}

function renderHistoryList() {
  if (historyItems.length === 0) {
    els.historyList.innerHTML = '<div class="history-empty">暂无历史记录</div>';
    return;
  }
  
  const sortedItems = [...historyItems].sort((a, b) => {
    // 先按收藏状态排序，再按时间排序
    if (a.bookmarked !== b.bookmarked) {
      return b.bookmarked ? 1 : -1;
    }
    return new Date(b.timestamp) - new Date(a.timestamp);
  });
  
  els.historyList.innerHTML = sortedItems.map((item, index) => {
    const date = new Date(item.timestamp).toLocaleString('zh-CN');
    const followupCount = item.followUps ? item.followUps.length : 0;
    
    return `
      <div class="history-item ${item.bookmarked ? 'bookmarked' : ''}">
        <div class="history-content">
          <div class="history-sentence">${escapeHtml(item.sentence)}</div>
          <div class="history-meta">
            ${date}
            ${followupCount > 0 ? `<span class="history-followups">• ${followupCount} 条追问</span>` : ''}
          </div>
        </div>
        <div class="history-actions">
          ${item.bookmarked ? '<span class="history-bookmark">★</span>' : ''}
          <button onclick="deleteHistoryItem('${item.id}')" style="background: #ef4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer;">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

function toggleHistoryViewer() {
  historyVisible = !historyVisible;
  if (historyVisible) {
    renderHistoryList();
    els.historyViewer.style.display = 'block';
    els.viewHistoryBtn.textContent = '隐藏历史记录';
  } else {
    els.historyViewer.style.display = 'none';
    els.viewHistoryBtn.textContent = '查看历史记录';
  }
}

function clearAllHistory() {
  if (!confirm('确定要清空所有历史记录吗？此操作不可恢复。')) {
    return;
  }
  
  historyItems = [];
  chrome.storage.local.set({ duolingoHistory: [] }, () => {
    updateHistoryStats();
    if (historyVisible) {
      renderHistoryList();
    }
    showMsg('已清空所有历史记录', '#ef4444');
  });
}

function exportBookmarks() {
  const bookmarkedItems = historyItems.filter(item => item.bookmarked);
  if (bookmarkedItems.length === 0) {
    showMsg('没有收藏的记录可导出', '#dc2626');
    return;
  }
  
  // 构建导出数据
  const exportData = {
    exportTime: new Date().toISOString(),
    totalItems: bookmarkedItems.length,
    items: bookmarkedItems.map(item => ({
      sentence: item.sentence,
      explanation: item.explanation,
      timestamp: item.timestamp,
      followUps: item.followUps || []
    }))
  };
  
  // 创建并下载文件
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `duolingo-bookmarks-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showMsg(`已导出 ${bookmarkedItems.length} 条收藏记录`, '#16a34a');
}

function deleteHistoryItem(itemId) {
  if (!confirm('确定要删除这条记录吗？')) {
    return;
  }
  
  historyItems = historyItems.filter(item => item.id !== itemId);
  chrome.storage.local.set({ duolingoHistory: historyItems }, () => {
    updateHistoryStats();
    if (historyVisible) {
      renderHistoryList();
    }
    showMsg('已删除记录', '#ef4444');
  });
}

// 暴露删除函数到全局作用域
window.deleteHistoryItem = deleteHistoryItem;