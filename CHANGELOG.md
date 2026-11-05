# Changelog

All notable user-visible changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). There are no tagged releases yet: version numbers start with the first release (planned for M5), so everything below is under "Unreleased", grouped by milestone. A Chinese summary follows the English text (中文摘要见下方).

## [Unreleased]

### M2 · Tools and files (in progress)

#### Added

- **Tool framework and approvals** (ADR 0010):
  - every tool has a risk level (`read`, `write`, `external`, `dangerous`) that decides whether it runs directly or needs your approval;
  - approval requests are saved and expire after 30 minutes;
  - when approving, you can choose "always in this session" or "always", except for tools that send things out or are dangerous;
  - pre-authorizations are listed in Settings and can be revoked;
  - a pending approval from any session shows in a panel at the top of the Web UI;
  - a local audit log (Web UI → Audit) records writes, outgoing actions, denied calls and pre-authorization changes, with redacted inputs.
- New endpoints `GET /tools`, `GET /approvals`, `GET` / `DELETE /preauthorizations` and `GET /audit`. `POST /approvals/{callId}` accepts an optional `remember`.
- **Built-in tools**:
  - `time` (current time in any IANA time zone);
  - `calc` (exact arithmetic with its own parser, no `eval`);
  - `web.fetch`:
    - fetches a page as text, marked as untrusted content;
    - needs approval and can only be pre-authorized per domain;
    - blocks loopback, private, link-local and cloud metadata addresses, including after DNS lookups and redirects;
    - limits responses to 2 MB and 15 seconds.
- **File tools** (ADR 0011):
  - `fs.list`, `fs.read` and `fs.search` (read) and `fs.write` and `fs.move` (write, need approval) only work inside the folders you authorize in Settings → Authorized folders.
  - Paths are resolved to their real location (links, junctions and Windows 8.3 short names) before checking.
  - Alternate data streams, device names, UNC paths and names ending in a dot or space are rejected.
  - Writes are atomic and never replace a file unless asked.
  - Write approvals can only be remembered per folder.
  - Out-of-folder attempts are audited.
- **Knowledge map, data layer** (ADR 0012): files in your authorized folders, detected novels (book → chapter, UTF-8 or GB18030) and sessions are indexed as items with consistent counts. `/api/v1/items/*` lists roots, children, ancestors, counts, subtrees, search and changes, and opens items after re-checking file permissions. Read-only `items.*` tools let the model browse it. The Web UI has a minimal tree browser. Revoking a folder soft-deletes its items.
- **Document reading**: `fs.read` turns PDF, DOCX and XLSX files into text, with PDF pages and XLSX sheets labelled. Parsing runs in a short-lived worker thread with memory and time limits, so idle memory is unchanged. Encrypted documents and ZIP bombs are refused.
- **MCP client, stdio only** (ADR 0013): add local MCP servers in Settings → MCP servers or with `/api/v1/mcp/servers`. Their tools appear as `mcp.<server>.<tool>` and, whatever the server claims, need your approval by default; you can set a per-tool level through the API. The command runs without a shell and only receives a minimal environment plus variable names you list (never `AIP_*`); no values are stored. Output, including error text, is marked as untrusted. Removing a server also removes its pre-authorizations. The client code loads only when a server is configured, so idle memory is unchanged. Streamable HTTP is deferred.
- **Embeddings and vector index** (ADR 0014): OpenAI-compatible profiles with the `embed` purpose can now embed text through `/embeddings`. Vectors are stored with sqlite-vec in a table sized to the profile's dimensions, and are removed together with their items. A background queue embeds one batch at a time, retries with backoff and stops at a daily limit (5,000 texts by default). If you change the embedding model or its dimensions, Settings → Vector index asks you to rebuild. `GET /embeddings/status` and `POST /embeddings/rebuild` are new. sqlite-vec is only loaded when an embed profile exists or a vector index was built before. The knowledge base and memory search will use this in later PRs.
- **Local knowledge base** (ADR 0015): Markdown, text, PDF, DOCX and XLSX files in your authorized folders are split into chunks by heading and paragraph, keeping PDF page numbers. You can set the chunk size in Settings (default 1,000 characters). Chunks are embedded when an embed profile exists. The new `kb.search` tool (read) uses vector search and falls back to full-text search. It returns numbered passages with the file name and page, and the Web UI shows them as citations. Indexing is incremental, and deleting a file or revoking a folder removes its chunks and vectors.
- **Memory v2 groundwork** (ADR 0007 §5): the database is migrated to the memory v2 schema without rebuilding M1 tables, and the database is backed up first. Existing memories keep their text. They now appear in the knowledge map as Memory → domain → type, with replaced values under a hidden "History" folder and linked to the value that replaced them. New contract types for memory v2 and the `memory-used` event are added; the behaviour of `memory.save` / `memory.search` does not change yet.
- **Memory write path** (ADR 0007 §5.5):
  - credentials (API keys, tokens, JWTs, private keys, passwords, connection strings, TOTP seeds, high-entropy strings) are refused before anything is stored;
  - bank card numbers, ID numbers, mobile numbers and detailed addresses are replaced with placeholders before a memory is saved;
  - entity keys are normalized; repeated facts are merged; a new value for a single-value key replaces the old one, or both are marked as conflicting when the new value is less certain;
  - invalid, overlong or instruction-like content from outside sources goes to a quarantine for 14 days instead of memory.
- New tool `memory.write` (`memory.save` is now its alias). It saves without asking when your own message triggered it, nothing sensitive is involved and no profile fact is replaced; otherwise it asks for approval. Settings: `memory.alwaysApprove` asks every time.
- Automatic memory extraction after each turn (off by default; `memory.autoExtract`, at most `memory.extractDailyLimit` = 200 cheap-model calls per day). It only reads your message and the final answer, never tool output; after a turn that read outside content it only proposes memories into the quarantine.
- **Memory retrieval** (ADR 0007 §5.6): relevant memories are now added to the conversation automatically.
  - Recall combines full-text search (with a Chinese two-character fallback), vector search when an embed profile exists, and linked items.
  - Each memory is shown with a trust label: reliable, possibly stale, conflicted or inferred. The top results include where they came from.
  - The memory block is limited to `memory.blockTokens` (default 1,200 tokens, and at most 10% of the model's context).
  - A short digest of pinned memories, profile facts, accepted decisions and open conflicts is added at the start of each session (`memory.digestTokens`, default 400).
- New tool `memory.retrieve` (`memory.search` is now its alias) and endpoints `POST /memory/retrieve` and `GET /memory/digest`. The `memory-used` event is now sent with the memories used in each turn.

#### Changed

- `memory.search` with a query no longer falls back to the 20 most recent memories when nothing matches; an empty query still lists them.
- Approvals that were pending when the server restarted now expire instead of being lost silently.

### M1 · Chat core (2026-11-04)

#### Added

- **Bring your own model**: model profiles for any OpenAI-compatible endpoint (OpenAI, DeepSeek, OpenRouter, Ollama, LM Studio, vLLM…) and the native Anthropic Messages and Gemini APIs, all streamed. Profiles have purposes (`chat`, `cheap` for summaries), a connection test, and default chat / cheap profiles in settings. ([#4](https://github.com/CodingLossy/AI-Personal/pull/4), [#10](https://github.com/CodingLossy/AI-Personal/pull/10))
- **Keys never in plaintext**: profiles only reference keys as `env:NAME` (environment variable) or `file:NAME` (`secrets.yaml` in the data directory); `keyStatus` shows whether the key is found. Keys are redacted from logs, errors and recorded fixtures. ([#4](https://github.com/CodingLossy/AI-Personal/pull/4))
- **Versioned API `/api/v1`**: owner setup (local only, or with a one-time setup code), password login with cookie session + CSRF, personal access tokens, a login rate limit, problem+json errors, and an OpenAPI 3.1 document at `/api/v1/openapi.json` (authentication required). Every endpoint except three public ones returns 401 without credentials. ([#1](https://github.com/CodingLossy/AI-Personal/pull/1), [#3](https://github.com/CodingLossy/AI-Personal/pull/3))
- **Sessions and runs**: streamed replies over server-sent events, decoupled from the connection; resume with `Last-Event-ID`; cancel, retry and regenerate (old replies are kept as branches); idempotent sends with `clientMessageId`; a WebSocket event channel that replays missed events with `lastSeq`. ([#6](https://github.com/CodingLossy/AI-Personal/pull/6))
- **Tools and approvals**: a tool loop with an approval step; tools that need approval pause the run until you approve or reject them. ([#7](https://github.com/CodingLossy/AI-Personal/pull/7))
- **Memory v1**: the assistant can `memory.save` (needs your approval) and `memory.search`; credentials are refused. List, search, edit, retract and delete memories over the API, the CLI and the Web UI. Long sessions are summarized with the cheap profile; the original messages are always kept. ([#7](https://github.com/CodingLossy/AI-Personal/pull/7))
- **Storage**: a single SQLite database in the data directory with versioned migrations, a backup before each migration, and foreign keys enforced. ([#2](https://github.com/CodingLossy/AI-Personal/pull/2))
- **Client SDK `@ai-personal/client`** (Apache-2.0, no runtime dependencies) and the **`ai-personal` CLI**: `setup`, `login`, `chat`, `ask`, `sessions`, `models`, `memory`, `approve`, `serve`. ([#8](https://github.com/CodingLossy/AI-Personal/pull/8))
- **Web UI**: setup and sign-in, session list, streamed Markdown chat that resumes after a page refresh, approve / reject buttons, settings (language zh-CN / en, light / dark / system theme, default profiles), model profile management and a memory page. ([#9](https://github.com/CodingLossy/AI-Personal/pull/9))
- `GET` / `PUT /api/v1/settings`. ([#9](https://github.com/CodingLossy/AI-Personal/pull/9))
- Real recorded DeepSeek fixtures for replay tests; keys are never written to fixtures, and CI scans them. ([#5](https://github.com/CodingLossy/AI-Personal/pull/5))

#### Notes

- Only one owner account (1.0 is single-user). The server listens on 127.0.0.1 by default; use a reverse proxy with HTTPS to expose it.
- The Docker image stays under 120 MiB of idle memory (95 MiB in CI).

### M0 · Project scaffolding (2026-11-03)

#### Added

- pnpm + Turborepo monorepo with TypeScript strict, ESLint, Prettier and Vitest; the `apps/` and `packages/` layout from the plan.
- Minimal Hono server (`/healthz`, `/api/v1/meta` with license and source URL) and a Vite + React Web UI shell.
- Dual licensing (AGPL-3.0-only + commercial), CLA, trademark and security policies, SPDX headers, REUSE compliance, and CI checks for licenses, placeholders and dependency licenses.
- Multi-stage Dockerfile (non-root) and docker-compose; CI builds the image and checks idle memory.

---

## 中文摘要(未发布)

### M2 · 工具与文件(进行中)

- **工具框架与审批**(ADR 0010):
  - 每个工具有风险级别(只读 / 写入 / 对外发送 / 危险),决定是直接执行还是需要你批准;
  - 审批请求会保存,30 分钟后过期;
  - 批准时可以选「本会话内总是允许」或「总是允许」(对外发送与危险工具除外);
  - 预授权在设置中可以查看和撤销;
  - 任何会话的待审批操作都会显示在 Web UI 顶部的面板中;
  - 本机审计日志(Web UI → 审计)记录写入、对外发送、被拒绝的调用与预授权变化,入参已脱敏。
- 新端点 `GET /tools`、`GET /approvals`、`GET` / `DELETE /preauthorizations`、`GET /audit`;`POST /approvals/{callId}` 可带 `remember`。
- **内置工具**:
  - `time`(任意 IANA 时区的当前时间);
  - `calc`(自写解析器的精确计算,不用 `eval`);
  - `web.fetch`:
    - 读取网页正文,标记为不可信内容;
    - 需要审批,只能按域名预授权;
    - 拒绝回环、私网、链路本地与云元数据地址(DNS 解析与跳转后同样校验);
    - 响应上限 2 MB、15 秒。
- **文件工具**(ADR 0011):
  - `fs.list`、`fs.read`、`fs.search`(只读)与 `fs.write`、`fs.move`(写入,需审批)只能在设置 → 授权目录中授权的文件夹内使用。
  - 检查前先把路径解析为真实位置(链接、junction、Windows 8.3 短名)。
  - 拒绝备用数据流、设备名、UNC 路径以及以点或空格结尾的名称。
  - 写入是原子的,默认不覆盖。
  - 写入审批只能按文件夹记住。
  - 越权的尝试会写审计。
- **知识地图数据层**(ADR 0012):授权目录中的文件、识别出的小说(书 → 章,UTF-8 或 GB18030)与会话登记为条目,计数保持一致;`/api/v1/items/*` 提供顶层类别、子项、祖先、计数、子树、搜索与增量变更,打开时重新校验文件权限;只读的 `items.*` 工具让模型也能浏览;Web UI 有最简的树形浏览;撤销授权目录时对应条目软删除。
- **文档读取**:`fs.read` 把 PDF、DOCX、XLSX 转为文本,并标注 PDF 页码与 XLSX 工作表名。解析在短时的 worker 线程中进行,有内存与时间上限,空闲内存不变。拒绝加密文档与 ZIP 炸弹。
- **MCP 客户端(仅 stdio)**(ADR 0013):在「设置 → MCP 服务器」或 `/api/v1/mcp/servers` 添加本机 MCP 服务器。它的工具以 `mcp.<服务器>.<工具>` 出现,不论服务器如何声明,默认都需要你批准;可以通过 API 按工具设置级别。命令不经过 shell 运行,只拿到最少的环境变量加上你列出的变量名(永远不含 `AIP_*`),不保存任何值。输出(包括错误文本)标为不可信。删除服务器时一并删除它的预授权。只有配置了服务器才加载客户端代码,空闲内存不变。Streamable HTTP 推迟。
- **嵌入与向量索引**(ADR 0014):带 `embed` 用途的 OpenAI 兼容配置档现在可以通过 `/embeddings` 嵌入文本。向量用 sqlite-vec 保存,表的维度取自配置档,条目删除时向量一并删除。后台队列每次处理一批,失败后退避重试,到达每日上限(默认 5,000 条)后停止。更换嵌入模型或维度后,「设置 → 向量索引」会提示重建。新增 `GET /embeddings/status` 与 `POST /embeddings/rebuild`。只有存在 embed 配置档或以前建过向量索引时才加载 sqlite-vec。知识库与记忆检索会在后续 PR 中使用它。
- **本地知识库**(ADR 0015):授权目录中的 Markdown、文本、PDF、DOCX、XLSX 按标题与段落分块,并保留 PDF 页码。块大小可在设置中调整(默认 1,000 字符)。存在 embed 配置档时分块会被嵌入。新工具 `kb.search`(read)优先用向量检索,没有向量时退回全文检索;它返回带文件名与页码的编号片段,Web 中显示为引用。索引是增量的;删除文件或撤销授权目录后,它的分块与向量会被清理。
- **记忆 v2 基础**(ADR 0007 第 5 节):数据库迁移到记忆 v2 的结构,不重建 M1 的表,迁移前自动备份。已有记忆的正文不变,并出现在知识地图中:「记忆 → 域 → 类型」,被更替的旧值放在隐藏的「历史版本」下,并链接到更替它的新值。新增记忆 v2 的契约类型与 `memory-used` 事件;`memory.save` / `memory.search` 的行为暂时不变。
- **记忆写入路径**(ADR 0007 第 5.5 节):
  - 凭据(API key、令牌、JWT、私钥、密码、连接串、TOTP 种子、高熵串)在落库前一律拒存;
  - 银行卡号、身份证号、手机号与详细住址在写入前替换为占位文字;
  - entity_key 规范化;重复的事实合并;单值键的新值更替旧值,新值把握不够时两条都标为冲突;
  - 来自外部、不合法、过长或像指令的内容进隔离区(保留 14 天),不进记忆。
- 新工具 `memory.write`(`memory.save` 成为它的别名):由你本人的消息触发、不涉及敏感内容、不更替画像事实时直接写入,其余情况需要审批;设置 `memory.alwaysApprove` 可改为每次都审批。
- 每轮结束后的自动抽取(默认关闭;`memory.autoExtract`,每天最多 `memory.extractDailyLimit` = 200 次 cheap 模型调用):只读你的消息和最终回答,不读工具输出;读过外部内容的那一轮只把建议放进隔离区。
- **记忆检索**(ADR 0007 第 5.6 节):相关记忆现在会自动加进对话。召回结合全文检索(含中文二字词回退)、有 embed 配置档时的向量检索,以及关联条目;每条带可信度标签(可靠 / 可能过时 / 有冲突 / 推断),分数最高的几条附出处。记忆块不超过 `memory.blockTokens`(默认 1,200 tokens,且不超过模型上下文的 10%)。每个会话开头注入一段 digest:置顶记忆、画像事实、已接受的决策与待确认的冲突(`memory.digestTokens`,默认 400)。
- 新工具 `memory.retrieve`(`memory.search` 成为它的别名),新端点 `POST /memory/retrieve` 与 `GET /memory/digest`;每轮会发送 `memory-used` 事件,列出用到的记忆。
- `memory.search` 带查询而没有命中时,不再回退为最近 20 条;空查询仍列出最近的记忆。
- 服务器重启时尚未处理的审批请求会过期,不再悄悄丢失。

### M1 · 对话核心(2026-11-04)

- **自带模型**:任意 OpenAI 兼容端点(OpenAI、DeepSeek、OpenRouter、Ollama、LM Studio、vLLM 等)以及 Anthropic、Gemini 原生接口,均为流式;配置档有用途(对话 / 廉价摘要)、连接测试,并可在设置中指定默认配置档。
- **密钥不落明文**:配置档只能用 `env:NAME` 或 `file:NAME`(数据目录下的 `secrets.yaml`)引用密钥,`keyStatus` 显示是否找到;日志、错误与录制数据中的密钥一律脱敏。
- **版本化 API `/api/v1`**:主人初始化(仅本机或凭一次性设置码)、密码登录(Cookie 会话 + CSRF)、个人访问令牌、登录限速、problem+json 错误、需鉴权的 OpenAPI 3.1 文档;除 3 个公开端点外,未登录一律 401。
- **会话与运行**:SSE 流式回复与连接解耦,可用 `Last-Event-ID` 续看;支持中断、重试、重新生成(旧回复保留为分支)、幂等发送;WebSocket 事件通道断线后按 `lastSeq` 补发。
- **工具与审批**:需要审批的工具调用会暂停运行,等你批准或拒绝。
- **记忆 v1**:助手可调用 `memory.save`(需批准)与 `memory.search`,凭据拒存;可通过 API、命令行和 Web UI 查看、搜索、编辑、撤回、删除记忆;长会话用廉价配置档压缩,原文始终保留。
- **存储**:数据目录中的单个 SQLite 数据库,版本化迁移,迁移前自动备份,强制外键约束。
- **客户端 SDK `@ai-personal/client`**(Apache-2.0,零运行时依赖)与 **`ai-personal` 命令行**。
- **Web UI**:初始化与登录、会话列表、流式 Markdown 聊天(刷新页面后续看)、批准 / 拒绝按钮、设置(中英文、深浅色、默认配置档)、模型配置档管理、记忆页。
- 说明:1.0 只有一个主人账户;默认只监听 127.0.0.1;Docker 镜像空闲内存低于 120 MiB(CI 中为 95 MiB)。

### M0 · 工程脚手架(2026-11-03)

- 单仓工程与工具链、最小 server 与 Web 壳、双许可与合规文件、CI 检查、Docker 镜像与内存门禁。
