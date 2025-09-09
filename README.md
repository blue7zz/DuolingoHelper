# Duolingo Deepseek Helper

答错题后自动捕获多邻国页面上显示的**正确答案句子**，调用 Deepseek API 生成翻译、语法讲解、扩展例句等，并在左侧浮动面板展示。

## 功能
- 监测（MutationObserver）多邻国错误反馈出现的答案节点
- 去重处理，避免同一句多次请求
- 将句子发送给后台 Service Worker，调用 Deepseek Chat Completion
- 左侧固定面板显示：原句 + Markdown 解析 (简单替换，可自行接入更完善的 Markdown 解析器)
- 可在扩展选项页面设置 Deepseek API Key
- **中文内容过滤**：可选择排除包含中文字符的句子，避免发送给AI处理（默认启用）

## 安装步骤
1. 克隆或下载本仓库。
2. 打开 Chrome -> 访问 `chrome://extensions/`
3. 右上角打开「开发者模式」。
4. 选择「加载已解压的扩展程序」，指向本目录。
5. 在扩展的「详情」里点击「扩展选项」或直接访问 options 页面，填入你的 Deepseek API Key。
6. 打开 https://www.duolingo.com/ ，开始练习，答错时待正确答案出现，左边面板应出现解析。

## 自定义
- 若多邻国的 class 变化，可在 `src/content.js` 中修改 `TARGET_CLASS_PART` 或增加更精准的上层容器选择器。
- 修改提示词：在 `src/background.js` 的 `systemPrompt` / `userPrompt` 里自定义你想要的输出结构。
- 若需更强 Markdown：引入 `marked` 或其他解析库（需要配置 Manifest CSP）。
- 面板位置 / 样式修改：编辑 `src/panel.css`。

## 安全与注意
- API Key 存在 `chrome.storage.sync` 中，受浏览器同步策略影响。若想只保存在本地，可换用 `chrome.storage.local`。
- 不要将真实 Key 上传到公共仓库。
- Deepseek 计费或调用限制请参考官方文档。

## 潜在改进
- 面板拖拽、折叠
- 对不同语言自动检测，针对性讲解
- 历史记录列表
- 失败重试（指数退避）
- 去抖或合并多句请求
- 使用 streaming（若 Deepseek 支持 SSE）

## 可能失效的原因
- 多邻国 DOM 结构 / class 频繁变化
- 网络拦截 / CORS（理论上 background fetch 可行）
- API Key 无效、额度不足

## 许可
MIT
