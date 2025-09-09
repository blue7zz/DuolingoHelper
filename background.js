// 背景 Service Worker：读取用户自定义 Prompt，调用 Deepseek API
// 如果之前已经有逻辑，请整体替换为本版本

async function callDeepseek(config, sentence) {
  const {
    apiKey,
    systemPrompt,
    userPrompt,
    model,
    temperature,
    enableMarkdown
  } = config;

  if (!apiKey) {
    throw new Error("尚未设置 Deepseek API Key。");
  }

  const finalSystem = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;
  const contextVars = buildContextVariables(sentence);
  const finalUser = renderTemplate(userPrompt?.trim() || DEFAULT_USER_PROMPT, contextVars);

  const body = {
    model: model || "deepseek-chat",
    messages: [
      { role: "system", content: finalSystem },
      { role: "user", content: finalUser }
    ],
    temperature: typeof temperature === "number" ? temperature : 0.4
  };

  const resp = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error("Deepseek API 调用失败: " + resp.status + " - " + txt);
  }

  const data = await resp.json();
  let content = data?.choices?.[0]?.message?.content || "(无返回)";

  // 如果用户关闭 markdown 处理，可在 content script 那边不再做转换
  // 这里只是透传
  return {
    content,
    usedSystem: finalSystem,
    usedUser: finalUser,
    contextVars
  };
}

// 默认提示词（系统 + 用户）
const DEFAULT_SYSTEM_PROMPT = `你是一个专业的语言学习助手。请遵守：
1. 解释简洁分层。
2. 先给出自然翻译，再做结构剖析。
3. 避免冗长无关寒暄。
4. 使用合适的 Markdown 层次。
`;

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

// 构造上下文变量
function buildContextVariables(sentence) {
  return {
    sentence,
    now: new Date().toISOString(),
    sentenceLength: sentence.length.toString(),
    languageDetected: detectLanguage(sentence)
  };
}

// 非严格语言检测，仅示例，可自行扩展
function detectLanguage(text) {
  // 简单判断：包含汉字范围
  if (/[\u4e00-\u9fff]/.test(text)) return "Chinese";
  // 含大量拉丁字母 + 空格
  if (/^[A-Za-z0-9 ,.'";:!?()-]+$/.test(text)) return "English/Latin-like";
  if (/[áéíóúñ¿¡]/i.test(text)) return "Spanish-like";
  if (/[àâçéèêëîïôûùüÿœæ]/i.test(text)) return "French-like";
  return "Unknown";
}

// 检查文本是否包含中文字符
function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

// 模板渲染
function renderTemplate(tpl, vars) {
  return tpl.replace(/\{\{(.*?)\}\}/g, (_, k) => {
    const key = k.trim();
    return vars[key] != null ? vars[key] : "";
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "DEEPSEEK_EXPLAIN") {
    const sentence = msg.answerText || "";
    chrome.storage.sync.get([
      "deepseekApiKey",
      "systemPrompt",
      "userPrompt",
      "model",
      "temperature",
      "enableMarkdown",
      "excludeChinese"
    ], async (cfg) => {
      try {
        // Check if Chinese filtering is enabled and sentence contains Chinese
        if (cfg.excludeChinese !== false && hasChinese(sentence)) {
          sendResponse({ 
            ok: false, 
            error: "包含中文字符的句子已被过滤，不会发送给AI进行处理" 
          });
          return;
        }

        const res = await callDeepseek({
          apiKey: cfg.deepseekApiKey,
            systemPrompt: cfg.systemPrompt,
            userPrompt: cfg.userPrompt,
            model: cfg.model,
            temperature: (cfg.temperature !== undefined ? Number(cfg.temperature) : undefined),
            enableMarkdown: cfg.enableMarkdown
        }, sentence);

        sendResponse({
          ok: true,
          explanation: res.content,
          usedSystem: res.usedSystem,
          usedUser: res.usedUser,
          contextVars: res.contextVars
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true; // 异步
  }
});