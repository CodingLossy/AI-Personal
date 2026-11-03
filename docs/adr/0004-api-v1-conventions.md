# ADR 0004 · API v1 约定:鉴权、错误格式、分页、流式事件

- 状态:已采纳(M1 实施方案,业主 2026-11-03 确认)
- 日期:2026-11-03
- 来源:开发计划 6.1、第 7 节;`docs/milestones/M1-plan.md` 第 3 节
- 契约代码:`packages/shared/src/{errors,pagination,auth,sessions,events,ws}.ts`

## 背景

Web UI、CLI、IM 渠道以及以后的桌面 / 移动客户端都只能通过公开 API 使用核心。M1 是第一次真正定义 `/api/v1`,发布后只能做向后兼容的增量修改(AGENTS.md 第 6 条),所以通用约定要先定下来。

## 决定

### 1. 路径与版本

- REST 统一前缀 `/api/v1`,WebSocket 为 `GET /api/v1/ws`。
- 每个响应带 `X-AIP-Server-Version` 与 `X-Request-Id`;请求带 `X-Request-Id` 时原样沿用(仅接受 ≤64 位的 `[A-Za-z0-9_-]`),否则由服务器生成 ULID。
- `GET /api/v1/meta` 返回 `protocolVersion` 与 `capabilities`,客户端据此渐进显示功能。

### 2. 鉴权

- **公开端点只有三个**:`GET /api/v1/meta`、`GET /api/v1/auth/status`、`POST /api/v1/auth/login`;另外 `POST /api/v1/auth/setup` 只在尚未初始化主人账户时可用,且只接受来自本机回环地址的请求,或携带启动日志中打印的一次性设置码。其余端点(包括 `GET /api/v1/openapi.json`)一律需要鉴权,否则返回 401。
- **Web**:登录后下发 HttpOnly、`SameSite=Strict`、`Secure`(HTTPS 下)、`Path=/` 的会话 Cookie;修改类请求(非 GET / HEAD / OPTIONS)必须带 `X-CSRF-Token`,其值在登录响应中返回,服务器只存哈希。
- **CLI / 脚本**:`Authorization: Bearer aip_pat_<随机串>` 个人访问令牌;明文只在创建时返回一次,库中只存 SHA-256 哈希;可设过期时间,可吊销。Bearer 请求不需要 CSRF 头。
- **单用户**:1.0 只有一个主人账户;所有数据带 `ownerId`,API 中不出现任何多用户概念。
- 登录限速:每个来源 IP 每分钟 5 次失败后返回 429。TOTP 推迟到 M5。

### 3. 错误格式

- 一律返回 `application/problem+json`(RFC 9457),字段:`type`(默认 `about:blank`)、`title`、`status`、`code`(机器可读,见 `ErrorCode` 枚举)、`detail?`、`requestId`、`issues?`(参数校验失败时的字段路径与消息)、`providerCode?`(上游模型错误的归类)。
- `code` 枚举只增不改;客户端必须把未知 `code` 当作通用错误处理。
- 错误中**不得**出现密钥、令牌、密码或上游原始错误正文;上游错误先经脱敏(ADR 0006)。

### 4. 分页

- 列表统一游标分页:`?cursor=<不透明字符串>&limit=<1–200,默认 50>`,响应 `{ items, nextCursor }`;`nextCursor` 为 `null` 表示已到末尾。游标对客户端不透明,服务器内部基于 ULID / 序号,保证并发插入时不重不漏。

### 5. 运行与流式事件

- 一次「用户消息 → 助手回复」是一个**运行(run)**,与 HTTP 连接解耦:客户端断开不会中断运行,只有 `POST /api/v1/runs/:runId/cancel` 会。
- 运行中产生的每个事件都持久化,并带**全局单调递增的 `seq`**(按 owner 计)。事件信封:`{ seq, at, sessionId, event }`,`event` 为 `AgentEvent`。
- **SSE**:`POST /api/v1/sessions/:id/messages` 默认直接返回 `text/event-stream`;`GET /api/v1/runs/:runId/events` 用于续看,先补发 `Last-Event-ID`(或 `?after=<seq>`)之后的事件,运行未结束时继续推送。帧格式:`id: <seq>`、`event: agent`、`data: <EventEnvelope JSON>`;每 15 秒发一行 `: ping` 注释作心跳,并设置 `X-Accel-Buffering: no`。运行结束(`run-finished` / `run-failed`)后服务器关闭流。
- **WebSocket**:帧 `{ v: 1, type, id, seq?, payload }`;客户端 `hello` 时带 `protocolVersion` 与 `lastSeq`,服务器先补发 `lastSeq` 之后的事件,再推送实时事件;30 秒 ping / pong。SSE 与 WebSocket 使用同一个 `seq`,可以互相补发。
- 补发窗口默认 24 小时;超出窗口的文本增量事件会被合并(助手消息正文已完整保存在消息表中),客户端此时应改为读取消息列表。

### 6. 幂等

- `POST /api/v1/sessions/:id/messages` 接受可选 `clientMessageId`;同一会话内重复提交相同值时,返回已有运行而不是新建,避免网络重试导致重复回复。

### 7. OpenAPI

- 路由用 `@hono/zod-openapi` 定义,`GET /api/v1/openapi.json`(需鉴权)由同一份 zod schema 生成;CI 另导出静态文件 `openapi/v1.json` 作为 oasdiff 破坏性变更检测的基线。

## 后果

- 所有客户端用同一套鉴权、错误、分页与事件机制;断线续看与多端同步天然成立。
- 事件表会随对话增长,需要 ADR 0005 中的合并策略控制体积。
- 以后新增事件类型、错误码、可选字段都是向后兼容的;删除或改名必须走 `/api/v2`。
