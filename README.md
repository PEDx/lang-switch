# Lang Switch

Lang Switch 是面向长文深度阅读的 AI 精译 Chrome 扩展。它专注于技术博客、研究文章、产品/工程设计文档和专栏文章，通过全文上下文分析与“初译 → 审阅 → 润色”流程，提供术语一致、语气自然的段落级双语阅读体验。

它不是普通网页整页翻译器，也不尝试替代 Chrome 自带翻译。按钮、菜单、输入框、OCR、PDF、划词词典和自动翻译所有网站不在当前产品范围内。

## 功能

- 自动识别 `article`、`main`、语义角色和大型正文容器，并综合正文规模、段落/标题、链接密度、表单、导航和可见面积评分。
- 手动区域或站点规则只覆盖自动正文的一小部分时，会展示全文覆盖率、自动正文规模和当前章节，并在用户选择“恢复全文”或明确确认局部翻译前阻止任务启动；新站点规则默认限定到当前文章路径。
- 根据 `h1`–`h6`、`p`、`li`、`blockquote`、`figcaption`、表格与定义列表提取稳定语义段落；代码块默认不翻译。
- 在正式翻译前分析全文主题、摘要、领域、受众、语气、术语和命名实体。
- 默认执行初始翻译、Chunk 级结构化审阅、最终重写三阶段精译；所有阶段共享文章上下文和同一段受控前后文。
- 按标题边界和 Token 预算分块，使用 `<TRANSLATE_THIS>` 明确当前目标；只把相邻上下文用于理解，不会误回写为译文。
- 持久化最近完成的译文作为连续性记忆，让后续 Chunk、暂停恢复和 Service Worker 重启后继续沿用既定术语与文风。
- 使用稳定段落 ID 和 Zod 校验模型 JSON；支持本地 JSON 提取及一次格式修复。
- 译文相邻插入原段落下方，不移动、不替换原正文节点。
- 双语、仅译文、仅原文三种显示方式及原文透明度调节。
- 逐 Chunk 更新进度，支持暂停、继续、停止、恢复原页面。
- Side Panel 提供集中运行中心和可复制的脱敏日志，实时展示当前 Provider / 模型、阶段、Chunk、请求尝试、超时进度、退避倒计时、HTTP 状态、平均延迟、成功率、Token 与预计剩余时间；请求超过 15 秒会持续提示等待警告。
- 单段复制与单段重译；重译绕过缓存，不会重新翻译全文。
- 高级模式支持页面语义区域挑选、标准 CSS Selector 校验/预览和站点规则。
- 支持多个 OpenAI Compatible / Anthropic Messages Provider。
- 持久化任务状态与有版本、容量和过期策略的翻译缓存。
- SPA URL 变化、正文延迟加载和文章区域内 DOM 变化的基础处理。
- 将识别到的正文导出为原文、译文或双语 Markdown；部分译文可按策略标记、忽略或回退原文。
- 可把图片、HTML5 视频、Poster 和音频下载到 `media/`，改写为相对路径并在浏览器本地生成 ZIP。

## 截图

> 截图占位：发布前应补充 Side Panel 自动识别、翻译进度、双语正文、Options Provider 配置和高级区域选择五张截图。

## 技术栈

- TypeScript 6
- React 19
- Vite 8
- Chrome Extension Manifest V3
- Chrome Side Panel API
- pnpm
- ESLint flat config
- Vitest + jsdom
- Zod
- 原生 DOM API 与 `fetch`

## 开发环境

- Node.js 20.19+ 或 22.12+（遵循 Vite 8 的运行要求）
- pnpm 10+
- Chrome 116+（Side Panel API）

安装依赖：

```bash
pnpm install
```

扩展开发模式会同时监听 UI、Content Script 和 Service Worker，并持续构建到 `dist/`：

```bash
pnpm dev
```

首次出现三个 `built in ...` 后，在 Chrome 加载 `dist/`。后续保存源码会自动重建；构建后仍需在 `chrome://extensions` 刷新扩展，修改 Content Script 后还要刷新目标文章页面。

仅预览 Side Panel / Options UI：

```bash
pnpm dev:ui
```

打开 `http://127.0.0.1:5173/` 可选择两个 UI 入口。普通网页环境没有完整 Chrome Extension API，因此该模式不用于验证翻译、存储或页面注入流程。

完整验证：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

可选的真实 Provider 集成测试会读取被 Git 忽略的 `.env.local`，不会由默认测试触发：

```bash
pnpm test:provider
```

本地变量名为 `AI_READER_PROVIDER_BASE_URL`、`AI_READER_PROVIDER_API_KEY` 和
`AI_READER_PROVIDER_MODEL`。不要提交 `.env.local` 或在测试日志中打印 Key。

`pnpm build` 依次构建：

1. Side Panel 与 Options 多页面 UI；
2. 单文件 IIFE Content Script；
3. 单文件 ES Module Service Worker。

最终可安装产物位于 `dist/`。

## 精译 Pipeline

当前精译流程借鉴 Translation Agent 的“初译 → 反思 → 改进”思想，但针对浏览器长文章做了结构化改造：

1. 全文分析生成主题、文章走向、作者语气、受众、术语表、命名实体和可执行的译文风格规则。
2. 每个 Chunk 同时获得受 Token 预算限制的前文、待译正文和后文；只有 `<TRANSLATE_THIS>` 内的稳定段落 ID 可以输出。
3. 初译允许在单个段落内拆句、合句和调整语序，同时保留事实、技术限定、比喻、幽默与节奏。
4. 审阅阶段把整个 Chunk 当作连续文章，优先检查误译、术语、机械直译、作者声音和段落衔接，不要求为每段机械生成意见。
5. 最终阶段根据 Chunk 级审阅真正重写译文，而不是只做同义词替换。
6. 最近完成的译文随任务持久化，并作为后续前文的 `translatedText` 传入；缓存 Key 同时包含这份连续性上下文和 Pipeline 版本。

没有原样重复发送整篇文章：完整原文会显著增加长文成本，也容易让较小模型忽略当前目标。扩展采用有界前后文和滚动译文记忆，同时保留逐 Chunk 显示、段落 ID 校验、单段重译与失败隔离。

## 运行监控与诊断

Side Panel 的“运行中心”以任务、Chunk、Pipeline 阶段和模型请求四层状态展示翻译过程：

- 每个模型调用生成独立 Request ID，并关联当前 Chunk 和初译、审阅、润色或 JSON 修复操作；
- 显示当前第几次尝试、单次超时上限、已等待时间、HTTP 状态和因 429 / 5xx / 网络 / 超时触发的重试倒计时；
- 汇总请求成功率、平均端到端延迟、失败与重试次数、Token 使用量和按已完成 Chunk 推算的剩余时间；
- Chunk 轨道分别标识等待、运行、完成和失败，单个失败不会抹掉其他译文；
- 当前 Chunk 使用“全文分析 → 初始翻译 → 翻译审阅 → 最终润色 → 页面回写”的横向时间点线展示阶段；
- 一个阶段等待超过 15 秒后，每 15 秒记录一次存活日志，避免外部接口尚未响应时界面看起来完全静止；
- 日志可按级别和模块筛选，并复制包含关联 ID 的诊断文本。日志不包含文章 Prompt、正文、API Key 或认证 Header。

网络错误、请求超时、429 和 5xx 会执行有限重试；401 / 403 直接失败。暂停、停止或启动新任务会使旧执行器失效，已排队的旧进度不能覆盖持久化的新状态。模型接口本身不提供服务器端排队阶段时，扩展只能显示客户端已等待时间，不能获知服务内部还需多久完成。

## Markdown 导出

文章识别成功后，Side Panel 会显示默认折叠的“文章导出”卡片，其外观与“高级模式”一致；展开后即可配置导出。原文无需翻译即可导出；已有部分或全部最终译文时，还可以选择译文和双语模式。正在进行的导出会保持展开以显示进度与取消操作。

- **原文**：按正文 DOM 的语义结构生成 Markdown，不包含扩展插入的译文、工具栏、导航、评论和广告节点。
- **译文**：通过稳定 segment ID 合并最终精译结果，不读取页面译文 `<div>`；缺失译文默认输出 `<!-- 此段尚未翻译 -->` 并保留原文。
- **双语**：默认按“原文 → `**译文：**` → 译文”排列；高级设置也支持引用块和分隔线布局。
- **远程媒体**：生成单个 UTF-8 `.md`，相对页面链接转换为绝对 URL，页内锚点保持不变。
- **本地媒体**：下载已勾选的图片、HTML5 视频、Poster 和音频，成功资源改写到 `media/`，然后生成 `.zip`。

ZIP 根目录结构：

```text
article-title.md
media/
  image-001.webp
  video-001.mp4
  poster-001.jpg
```

Markdown 转换支持标题、段落、粗体、斜体、删除线、链接、行内代码、代码块、嵌套列表、引用、GFM 表格、Figure/Caption、图片、`<details>`、HTML5 Video/Audio 和 iframe 视频链接。复杂 `rowspan`/`colspan` 表格会降级为经过重新序列化的 HTML 表格，避免丢失内容。

### 媒体权限与限制

模型 API 和媒体下载域名使用 Manifest V3 `optional_host_permissions`。扩展只会在用户点击“开始精译”“测试连接”或“允许并继续”时，请求当前 Provider 或文章媒体实际需要的域名；媒体权限被拒绝后仍可退回仅保留远程链接的 Markdown 导出。

默认媒体限制为单文件 50 MB、总计 500 MB、最多 200 个资源、3 路并发和 30 秒超时。单个媒体失败默认不会中止导出，而是在 Markdown 中保留远程 URL。高级导出设置可以调整大小、并发、媒体类型和失败策略。

ZIP 由 `fflate` 在扩展 Background Service Worker 内生成。当前浏览器下载接口使用内存中的 UTF-8/二进制数据，因此大型视频会同时占用下载缓冲与 ZIP 内存；建议按需要关闭视频下载或降低总大小限制。YouTube、Vimeo、iframe、HLS、DASH、DRM、`blob:` 和 MediaSource 视频不会被下载，iframe 仅保留可访问链接。

## 在 Chrome 中安装

1. 运行 `pnpm build`。
2. 打开 `chrome://extensions`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本项目的 `dist/` 目录。
6. 打开一篇长文章，点击扩展图标；Side Panel 会自动打开并显示识别结果。

修改 Content Script、Service Worker 或 Manifest 后，需要重新构建并在扩展管理页点击“重新加载”。

## Provider 配置

在扩展设置页可以创建多个 Provider，并选择默认 Provider。API Key 不在源码中提供，也不会注入页面。

### OpenAI Compatible

典型 OpenAI 配置：

```text
API 类型：OpenAI Compatible
Base URL：https://api.openai.com/v1
Model：你的模型名称
```

默认请求 Endpoint 为：

```text
{baseUrl}/chat/completions
```

OpenRouter、公司内部兼容网关和其他 Chat Completions 兼容服务可以填写各自的 Base URL、Model、API Key。若网关路径不同，可在高级选项填写“完整 Endpoint”。

### Anthropic Messages

典型 Anthropic 配置：

```text
API 类型：Anthropic Messages
Base URL：https://api.anthropic.com
Model：你的 Claude 模型名称
Anthropic Version：2023-06-01
```

默认请求 Endpoint 为 `{baseUrl}/v1/messages`。如果 Base URL 已以 `/v1` 结尾，则使用 `{baseUrl}/messages`，避免重复路径。

### 自定义 API 网关

高级 Provider 选项支持：

- 自定义完整 Endpoint；
- JSON 格式的自定义 Headers；
- Temperature；
- 最大输出 Token；
- 请求超时；
- 最大并发数。

身份认证 Header 最后由 Provider 适配器设置，自定义 Header 不会覆盖扩展生成的 `Authorization` 或 `x-api-key`。

OpenAI Compatible 适配器会对 GPT-5 系列使用 `max_completion_tokens`，并省略该系列不支持的自定义 `temperature`；其他兼容模型仍使用通用的 `max_tokens` 和 Temperature 设置。

## 自动文章识别

识别顺序：

1. 已保存且仍有效的站点规则；
2. 自动文章候选评分；
3. 用户主动开启的高级手动选择。

候选优先考虑 `article`、`main`、`[role="main"]`、`[role="article"]`，同时评估文本长度、段落/标题数量、链接与按钮密度、导航/表单、代码块和可见面积。Class 名只作为辅助特征。导航、页脚、侧栏、评论、相关推荐和广告特征会被降权。

置信度过低时不会直接开始翻译，Side Panel 会提示使用高级模式。

Side Panel 会明确区分自动识别、手动区域和本站规则。如果手动区域或站点规则只覆盖自动正文候选的一小部分，会提示“区域可能不完整”，并提供恢复自动识别的入口；恢复本站规则时会同时清除当前命中的窄范围规则。

## 高级区域选择

高级模式默认关闭。开启后可以：

- 点击“在页面中选择区域”，悬停预览合格正文容器，单击确认，按 `Esc` 取消；
- 输入标准 CSS Selector，校验唯一性、可见性、正文规模并滚动预览；
- 把当前 Selector 保存为本站规则。

挑选器会把段落或行内元素向上提升到最近的合格正文容器，不允许直接选择 `span`、`a`、`button`、单个 `p`、单个 `li`、`svg` 等元素。普通网站全局 `header` 不会被当作文章区域。

第一版只支持标准 CSS Selector，不支持 JavaScript 表达式。多匹配 Selector 必须进一步收窄。

## DOM 安全

原正文元素仅会增加：

- `ai-reader-translation-*` 前缀 class；
- `data-ai-reader-*` 前缀属性。

译文使用带 `data-ai-reader-inserted` 标记的相邻节点插入。扩展不会移动、重建或替换原正文节点，因此不会主动破坏页面原有事件监听器。恢复原页面会删除所有扩展插入节点、class、data 属性、显示变量和文章 MutationObserver。

## API Key 安全

- Content Script 不读取 Provider 配置或 API Key。
- Service Worker 把 `chrome.storage.local` 访问级别限制为 `TRUSTED_CONTEXTS`。
- 模型调用路径为 Content Script / Side Panel → `chrome.runtime` 消息 → Background Service Worker → HTTPS 模型 API。
- API Key 不写入 DOM、console、翻译缓存 Key或错误消息。
- 诊断日志不保存 Prompt、文章正文、Authorization 或 API Key，持久化最多保留最近 1,000 条；Side Panel 为控制渲染开销显示当前任务最近 250 条。
- 扩展不读取 Cookie、页面 `localStorage`、表单输入或密码框。

浏览器扩展本地保存的 API Key 仍然可以被拥有本机扩展调试权限的用户访问。生产级云服务应使用自建服务端和短期凭证。

## 隐私说明

**被翻译的文章文本会发送到用户配置的模型 API 服务。**

发送内容包括页面标题、URL、文章标题、标题层级、文章抽样、待翻译语义段落、用户术语表和翻译要求。扩展不会把页面 Cookie、表单数据、页面脚本状态或 API Key加入翻译请求正文。数据处理与保留政策取决于用户选择的模型服务或自定义网关，请在使用前阅读对应服务条款。

Markdown 转换、链接改写和 ZIP 生成全部在浏览器扩展本地完成，不会把导出文章或媒体上传到扩展开发者服务器。启用媒体本地化会直接向原媒体服务器发起额外请求；请求会暴露常规网络信息，而需要登录 Cookie、防盗链 Header 或特殊会话的资源可能下载失败。媒体请求不主动携带页面 Cookie。请遵守文章与媒体的版权、许可和使用条款。

## 错误与恢复

- 网络错误、单次请求超时与 5xx 使用有限次数指数退避；
- 429 优先遵循 `Retry-After`；
- 401 / 403 不自动重试；
- 格式错误先本地提取 JSON，再进行一次格式修复；
- 每个 Chunk 独立失败，不移除其他已完成译文；
- 模型成功与页面回写分别校验；整块译文没有插入任何页面节点时不会再误报“翻译完成”；
- 暂停/停止会中断当前请求和退避等待；
- Service Worker 重启后，Side Panel 重新打开会读取 `tabId` 对应任务并继续未完成 Chunk；
- 已完成任务的最终译文会持久化；刷新文章或重新打开 Side Panel 后，会按稳定段落 ID 重新挂载到当前文章 DOM；
- 页面导航和标签页关闭会终止并清理关联任务。
- 导出任务进度会持久化；如果 Service Worker 在 ZIP 构建期间被浏览器终止，Side Panel 会明确标记中断并允许用户重新导出。

## 已知限制

- 当前主要面向静态 HTML 长文章，对无限滚动正文仅提供基础 MutationObserver 支持，不自动翻译评论区。
- 不支持 PDF、OCR、影子 DOM 内文章或跨源 iframe 正文。
- MVP 译文不恢复原段落中的 `<strong>`、链接等行内样式。
- 文章内容被站点彻底重建后，已完成译文节点可能需要重新精译。
- Provider 的可用模型、CORS/扩展访问策略、速率限制和数据政策由服务提供方决定。
- 最大并发设置已持久化；默认精译执行保持顺序，以优先保证上下文衔接和页面渐进回写。
- CSS `background-image`、`og:image`、跨源 iframe 内容和无法恢复 TeX 源的复杂公式不会作为媒体下载；公式只能在页面暴露 TeX 数据时可靠导出。
- ZIP 当前不是流式写入，大型媒体导出受可用内存限制；媒体请求使用 `credentials: omit`，登录态资源可能保留为远程链接。

## 项目结构

```text
src/
  background/
    service-worker.ts       # 消息路由、Provider 调用、任务执行
    task-manager.ts         # 任务 reducer 与持久化
    diagnostics.ts          # 脱敏集中日志与请求关联
    export-manager.ts       # 导出调度、进度、下载和保存
  content/
    index.ts                # 页面消息入口与 SPA/延迟加载处理
    article-detector.ts     # 候选收集、评分和站点规则
    segment-extractor.ts    # 语义分段与稳定 ID
    translation-renderer.ts # 安全相邻插入、显示模式、恢复
    advanced-region-picker.ts
    selector-validator.ts
    mutation-observer.ts
  sidepanel/
    App.tsx
    components/TranslationMonitor.tsx
    components/ExportPanel.tsx
  options/
    App.tsx
  shared/
    api/                    # Provider 接口和两个适配器
    translation/            # 分块、分析、精译、缓存、Prompt、JSON 校验
    export/                 # DOM 序列化、内容模式、媒体、权限、ZIP 和文件名
    messaging/              # Zod 跨模块消息 Schema
    schemas/                # Provider/模型输出运行时 Schema
    storage/                # 本地配置和任务存储
    types/
  test/fixtures/            # 文章识别与 Markdown/媒体导出 HTML Fixture
```

## 当前实现状态

翻译 Phase 1–10 与 Markdown/媒体导出 Phase 1–9 的 MVP 路径均已实现。自动测试覆盖文章识别、分段、Provider、结构化输出、缓存、任务状态、Markdown 元素、三种内容模式、缺失译文、媒体去重与路径、失败隔离、文件命名和 ZIP 二进制完整性。发布前仍建议在真实 Chrome 对常用站点执行一次跨域媒体授权、下载和大文件内存验收。
