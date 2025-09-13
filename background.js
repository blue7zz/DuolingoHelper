// 背景 Service Worker：读取用户自定义 Prompt，调用 Deepseek API
// 如果之前已经有逻辑，请整体替换为本版本

async function callDeepseekFollowup(config, originalSentence, originalExplanation, followupQuestion, previousFollowups = []) {
  const { apiKey, model, temperature } = config;

  if (!apiKey) {
    throw new Error("尚未设置 Deepseek API Key。");
  }

  const systemPrompt = `你是一个专业的语言学习助手。用户之前询问了一个句子的解析，现在有追加问题。请基于之前的解析内容和历史追问记录，针对用户的追问给出精准、简洁的回答。`;
  
  let conversationHistory = `原始句子：${originalSentence}

之前的解析内容：
${originalExplanation}`;
  
  if (previousFollowups.length > 0) {
    conversationHistory += `

历史追问记录：`;
    previousFollowups.forEach((followup, index) => {
      conversationHistory += `
${index + 1}. Q: ${followup.question}
   A: ${followup.answer}`;
    });
  }
  
  const userPrompt = `${conversationHistory}

用户新的追问：${followupQuestion}

请针对这个追问给出回答：`;

  const body = {
    model: model || "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
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

  return { content };
}

async function callDeepseekAnalyzeWrongAnswers(config, wrongAnswers) {
  const { apiKey, model, temperature } = config;

  if (!apiKey) {
    throw new Error("尚未设置 Deepseek API Key。");
  }

  if (!wrongAnswers || wrongAnswers.length === 0) {
    throw new Error("没有错误答案可以分析。");
  }

  const systemPrompt = `你是一个专业的语言学习分析师。你将分析用户在语言学习中的错误答案，找出错误模式，并提供改进建议。请使用Markdown格式输出结果。`;
  
  const wrongAnswerList = wrongAnswers.map((item, index) => 
    `${index + 1}. 正确答案: "${item.correctSentence}"
   用户的错误答案: "${item.wrongAnswer}"
   记录时间: ${item.timestamp}`
  ).join('\n\n');

  const userPrompt = `请分析以下${wrongAnswers.length}个错误答案，找出学习者的薄弱环节和错误模式：

${wrongAnswerList}

请按以下结构进行分析：

# 错误答案分析报告

## 📊 数据概览
- 错误答案总数：${wrongAnswers.length}
- 分析时间：${new Date().toLocaleString('zh-CN')}

## 🔍 错误模式分析
请分析并总结主要的错误类型（如语法错误、词汇错误、拼写错误等）

## 📋 具体错误分类
请将错误答案按类型分组，并给出每类错误的具体例子

## 💡 改进建议
针对发现的错误模式，提供具体的学习建议和练习方法

## 🎯 重点关注领域
列出需要重点加强的语言学习领域

## 📚 推荐学习资源
根据错误分析，推荐相应的学习资源或练习方法

---
*本报告由AI分析生成，建议结合实际情况进行学习规划*`;

  const body = {
    model: model || "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    temperature: typeof temperature === "number" ? temperature : 0.3
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

  return { content };
}
  const { apiKey, model, temperature } = config;

  if (!apiKey) {
    throw new Error("尚未设置 Deepseek API Key。");
  }

  const systemPrompt = `你是一个专业的语言学习助手。用户之前询问了一个句子的解析，现在有追加问题。请基于之前的解析内容和历史追问记录，针对用户的追问给出精准、简洁的回答。`;
  
  let conversationHistory = `原始句子：${originalSentence}

之前的解析内容：
${originalExplanation}`;
  
  if (previousFollowups.length > 0) {
    conversationHistory += `

历史追问记录：`;
    previousFollowups.forEach((followup, index) => {
      conversationHistory += `
${index + 1}. Q: ${followup.question}
   A: ${followup.answer}`;
    });
  }
  
  const userPrompt = `${conversationHistory}

用户新的追问：${followupQuestion}

请针对这个追问给出回答：`;

  const body = {
    model: model || "deepseek-chat",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
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

  return { content };
}

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
      "enableMarkdown"
    ], async (cfg) => {
      try {
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
  
  if (msg.type === "DEEPSEEK_FOLLOWUP") {
    const { originalSentence, originalExplanation, followupQuestion, previousFollowups } = msg;
    chrome.storage.sync.get([
      "deepseekApiKey",
      "systemPrompt", 
      "userPrompt",
      "model",
      "temperature",
      "enableMarkdown"
    ], async (cfg) => {
      try {
        const res = await callDeepseekFollowup({
          apiKey: cfg.deepseekApiKey,
          model: cfg.model,
          temperature: (cfg.temperature !== undefined ? Number(cfg.temperature) : undefined),
          enableMarkdown: cfg.enableMarkdown
        }, originalSentence, originalExplanation, followupQuestion, previousFollowups);

        sendResponse({
          ok: true,
          explanation: res.content
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true; // 异步
  }
  
  if (msg.type === "DEEPSEEK_ANALYZE_WRONG_ANSWERS") {
    const { wrongAnswers } = msg;
    chrome.storage.sync.get([
      "deepseekApiKey",
      "model",
      "temperature"
    ], async (cfg) => {
      try {
        const res = await callDeepseekAnalyzeWrongAnswers({
          apiKey: cfg.deepseekApiKey,
          model: cfg.model,
          temperature: (cfg.temperature !== undefined ? Number(cfg.temperature) : undefined)
        }, wrongAnswers);

        sendResponse({
          ok: true,
          analysis: res.content
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true; // 异步
  }
});