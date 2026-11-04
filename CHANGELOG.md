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

#### Changed

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
