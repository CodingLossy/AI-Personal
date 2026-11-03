# AI-Personal

[English](README.en.md) · 源码:<https://github.com/CodingLossy/AI-Personal> · 问题反馈:<https://github.com/CodingLossy/AI-Personal/issues>

一个真正属于你自己的 AI 助手:可自托管、开源、自带模型(BYO LLM)、本地优先、**零遥测**、插件化(MCP 为一等公民)。

> 当前状态:**M0 · 工程脚手架**。功能尚未可用,开发计划见 [docs/plan/AI-Personal-开发计划.md](docs/plan/AI-Personal-开发计划.md)。

## 特性(规划中)

- **BYO LLM**:任何 OpenAI 兼容端点(含 Ollama / LM Studio / vLLM),另支持 Anthropic / Gemini 原生接口。已确认可用的端点:DeepSeek(`https://api.deepseek.com/v1`)、OpenRouter(`https://openrouter.ai/api/v1`)
- **Headless 核心**:所有能力都通过版本化的 `/api/v1` HTTP + WebSocket API 提供,Web UI、CLI、IM 渠道都是它的客户端
- **本地文件、邮件、语音、定时任务**,工具按风险分级,危险操作默认需人工确认
- **渠道**:1.0 支持企业微信与微信
- **知识地图**:邮件、文档、小说、人物等汇入统一条目索引,可逐层钻取浏览
- **轻量**:2GB 内存的服务器即可常驻运行

## 零遥测承诺

AI-Personal **不包含任何**统计或崩溃上报代码。程序只会连接你配置的模型端点、邮箱、渠道和插件,以及(可关闭的)GitHub Releases 更新检查。

## 快速开始(开发)

需要 Node.js 24 LTS(最低 22.12)与 pnpm 10。

```bash
git clone https://github.com/CodingLossy/AI-Personal.git
cd AI-Personal
pnpm install
pnpm dev
```

- 核心服务:<http://127.0.0.1:8787/healthz>
- Web UI:<http://127.0.0.1:5173>

Docker:

```bash
docker compose -f docker/docker-compose.yml up --build
```

首次启动时需要创建主人账户(1.0 只有一个账户):

```bash
curl -X POST http://127.0.0.1:8787/api/v1/auth/setup   -H 'content-type: application/json'   -d '{"username":"owner","password":"至少 12 位的密码"}'
```

从本机直连时不需要设置码;从其他机器或经过反向代理初始化时,需要在请求中加上 `"setupCode"`,它打印在服务启动日志里(Docker 中用 `docker logs` 查看)。

参与开发请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

AI-Personal 采用双许可:

- **开源版**:[GNU AGPL-3.0](LICENSE)(`AGPL-3.0-only`)。你可以自由使用、修改和分发,包括商业用途,但如果你分发修改版或**通过网络向他人提供修改版服务**,必须以 AGPL-3.0 公开相应的完整源代码。
- **商业许可**:如果你希望在闭源产品或服务中使用、内嵌或修改 AI-Personal 而不承担 AGPL 的开源义务,请参阅 [COMMERCIAL.md](COMMERCIAL.md) 联系作者获取商业许可。

插件 SDK(`@ai-personal/plugin-sdk`)与客户端 SDK(`@ai-personal/client`)以 [Apache-2.0](packages/plugin-sdk/LICENSE) 发布。

贡献代码前需签署 [CLA](CLA.md)(PR 中会自动提示)。「AI-Personal」名称与 Logo 为作者商标,见 [TRADEMARKS.md](TRADEMARKS.md)。商业许可联系:x19169738916@163.com。

Copyright (C) 2026 尹绪柏 (Theodore Yin)
