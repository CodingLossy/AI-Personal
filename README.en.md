# AI-Personal

[中文](README.md) · Source: <https://github.com/CodingLossy/AI-Personal> · Issues: <https://github.com/CodingLossy/AI-Personal/issues>

An AI assistant that is truly your own: self-hostable, open source, bring-your-own-model (BYO LLM), local-first, **telemetry-free**, and pluggable (MCP is a first-class citizen).

> Status: **M0 · project scaffolding**. Nothing is usable yet; see the development plan (Chinese) at [docs/plan/AI-Personal-开发计划.md](docs/plan/AI-Personal-开发计划.md).

## Features (planned)

- **BYO LLM**: any OpenAI-compatible endpoint (including Ollama / LM Studio / vLLM), plus native Anthropic / Gemini support. Confirmed working: DeepSeek (`https://api.deepseek.com/v1`) and OpenRouter (`https://openrouter.ai/api/v1`)
- **Headless core**: every capability is exposed through the versioned `/api/v1` HTTP + WebSocket API; the Web UI, CLI and IM channels are all clients of it
- **Local files, email, voice, scheduled tasks**, with risk-graded tools; dangerous actions require confirmation by default
- **Channels**: WeCom (企业微信) and WeChat in 1.0
- **Knowledge map**: mail, documents, novels, people and more in one item index you can drill into level by level
- **Lightweight**: runs comfortably on a 2 GB server

## Telemetry-free

AI-Personal contains **no** analytics or crash-reporting code. It only connects to the model endpoints, mailboxes, channels and plugins you configure, plus an optional (can be disabled) GitHub Releases update check.

## Quick start (development)

Requires Node.js 24 LTS (minimum 22.12) and pnpm 10.

```bash
git clone https://github.com/CodingLossy/AI-Personal.git
cd AI-Personal
pnpm install
pnpm dev
```

- Core server: <http://127.0.0.1:8787/healthz>
- Web UI: <http://127.0.0.1:5173>

Docker:

```bash
docker compose -f docker/docker-compose.yml up --build
```

On first start, create the owner account (1.0 has exactly one account):

```bash
curl -X POST http://127.0.0.1:8787/api/v1/auth/setup   -H 'content-type: application/json'   -d '{"username":"owner","password":"at least 12 characters"}'
```

Direct local requests need no setup code. From another machine or through a reverse proxy, add `"setupCode"` to the request; the code is printed in the server log on startup (`docker logs` in Docker).

You can also set up and chat entirely from the command-line client, without the Web UI (after `pnpm build`, run it in `apps/cli` or via `pnpm --filter @ai-personal/cli exec ai-personal …`):

```bash
ai-personal setup -u owner          # create the owner and save a personal access token (~/.ai-personal/cli.json, mode 0600)
ai-personal models add --label deepseek --base-url https://api.deepseek.com/v1 --model deepseek-chat --key-ref env:DEEPSEEK_API_KEY
ai-personal ask "Explain AGPL section 13 in three sentences"
ai-personal chat                    # interactive chat: /new /model /retry /exit; Ctrl+C stops the current reply
```

Keys are only accepted as `env:` / `file:` references, never in plain text. Tool calls that need approval (such as `memory.save`) are asked about in a terminal and rejected when not interactive, unless you pass `--approve-tools`.

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.

## License

AI-Personal is dual-licensed:

- **Open source**: [GNU AGPL-3.0](LICENSE) (`AGPL-3.0-only`). You may use, modify and distribute it, including commercially, but if you distribute a modified version or **make a modified version available to users over a network**, you must release the complete corresponding source under the AGPL-3.0.
- **Commercial license**: to use, embed or modify AI-Personal in closed-source products or services without AGPL obligations, see [COMMERCIAL.md](COMMERCIAL.md).

The plugin SDK (`@ai-personal/plugin-sdk`) and client SDK (`@ai-personal/client`) are released under [Apache-2.0](packages/plugin-sdk/LICENSE).

Contributions require signing the [CLA](CLA.md) (prompted automatically on your PR). The "AI-Personal" name and logo are trademarks of the author; see [TRADEMARKS.md](TRADEMARKS.md). Commercial licensing: x19169738916@163.com.

Copyright (C) 2026 尹绪柏 (Theodore Yin)
