# ADR 0006 · 模型网关:ModelProvider 接口、密钥来源与脱敏

- 状态:已采纳(M1 实施方案,业主 2026-11-03 确认)
- 日期:2026-11-03
- 来源:开发计划第 1.4 节(BYO LLM)、3.5、第 6 节;`docs/milestones/M1-plan.md` 第 2 节
- 契约代码:`packages/shared/src/models.ts`;实现:`packages/providers`

## 背景

用户自带模型:任何 OpenAI 兼容端点(含 Ollama、LM Studio、vLLM、DeepSeek 等),以及 Anthropic / Gemini 原生接口。AI SDK 等依赖迭代很快,上层(agent、server)不能直接依赖它们的类型。密钥是最敏感的数据,来源和出口都必须受控。

## 决定

### 1. 自有接口,AI SDK 只是实现

`packages/providers` 对外只暴露 `ModelProvider`(`stream()` 产出 `ChatChunk` 异步序列,`test()` 做连接测试)与 `registry.forPurpose('chat' | 'cheap')`。内部用 Vercel AI SDK 7(`@ai-sdk/openai-compatible`、`@ai-sdk/anthropic`、`@ai-sdk/google`,均为 Apache-2.0)实现,依赖用 `~` 锁小版本。接口签名见 M1 方案第 2.1 节。

- 中断:`ChatRequest.signal`;取消后产出 `finish { reason: 'aborted' }`。
- 重试:只对连接错误、429、5xx 做一次退避重试,且只在尚未输出任何 token 时重试。
- 首 token 超时默认 60 秒(可配置)。
- 没有 cheap 配置档时回退到 chat 配置档。
- 上游错误归类为 `ProviderErrorCode`(`auth_failed` / `not_found` / `rate_limited` / `timeout` / `bad_request` / `upstream_error` / `network_error`),对外通过 problem+json 的 `providerCode` 字段返回(ADR 0004)。

### 2. 配置档与密钥引用

- 配置档(`model_profiles` 表)只保存 **`apiKeyRef`**,不保存明文:
  - `env:NAME`:读环境变量 `NAME`;
  - `file:NAME`:读数据目录下 `secrets.yaml` 中的 `NAME` 键;文件权限宽于 0600 时启动报警(Windows 上检查 ACL 不可行,只给出文档提示);
  - `null`:不需要密钥(如本机 Ollama)。
- **API 与 Web UI 不接收明文密钥**(业主决定)。服务器端加密存储推迟到 M5。
- `GET /api/v1/models` 返回 `apiKeyRef` 与 `keyStatus`(`present` / `missing` / `not_required`),从不回显密钥值。
- 明文密钥只在发请求的那一刻存在于内存中;不缓存到全局对象、不写入事件、不写入消息。

### 3. 脱敏

- pino `redact` 覆盖 `*.apiKey`、`*.authorization`、`*.headers.authorization`、`*.password`、`*.token`、`*.cookie`。
- 所有上游错误在抛出前经 `redact()`:把当前进程已加载的全部密钥值、`Bearer <token>`、`sk-…` / `ghp_…` 等常见密钥形态替换为 `[REDACTED]`,并截断上游错误正文(≤500 字)。
- 录制回放 fixture(`packages/eval`)在落盘前同样脱敏,并去掉 `Authorization` 等请求头;CI 中有一道检查,扫描 fixture 目录中是否出现高熵密钥形态。

### 4. 测试

- 回放测试覆盖:OpenAI 风格流(含 usage)、Ollama 风格流(无 usage)、工具调用、上游 401 / 429 / 500、首 token 超时、中途取消。
- 密钥泄露测试:用假密钥跑完整流程,上游 mock 在错误正文中回显该密钥;断言日志、API 响应、事件表、fixture 中都找不到它。

## 后果

- 换 LLM 库或升级 AI SDK 只影响 `packages/providers`。
- 用户必须通过环境变量或本地文件配置密钥,Web UI 只能选择引用;这对远程部署不够方便,M5 再补加密存储。
