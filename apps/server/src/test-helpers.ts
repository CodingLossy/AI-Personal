// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 仅供测试使用(不参与构建)。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { EventBus, RunManager } from '@ai-personal/agent';
import { createMemoryService } from '@ai-personal/memory';
import { createProvider, type ModelProvider, Redactor, SecretStore } from '@ai-personal/providers';
import { createRepositories, openStorage, type Repositories } from '@ai-personal/storage';
import type { WebFetchOptions } from '@ai-personal/tools';
import { createItemService } from '@ai-personal/items';
import { createSummarizer, createToolRegistry } from './agent-setup.js';
import { createApp, type AppDeps } from './app.js';
import { createMcpControl } from './mcp-setup.js';
import { createEmbeddingService, type EmbeddingService } from './embeddings.js';
import { FailureLimiter } from './auth/rate-limit.js';
import { createLogger } from './log.js';

export const TEST_PASSWORD = 'correct horse battery staple';
export const TEST_SETUP_CODE = 'setup-code-123456';

export interface TestServer {
    app: ReturnType<typeof createApp>;
    bus: EventBus;
    runs: RunManager;
    embeddings: EmbeddingService;
    dir: string;
    repos: Repositories;
    /** 本测试期间写出的全部日志行。 */
    logs: string[];
    cleanup(): Promise<void>;
}

/**
 * 真实 SQLite 文件 + 完整应用。请求头 x-test-ip 模拟 TCP 对端地址(默认 127.0.0.1)。
 */
export interface TestServerOptions {
    /** 模型请求使用的 fetch(回放或桩)。 */
    fetch?: typeof fetch;
    /** SecretStore 读取的环境变量。 */
    env?: NodeJS.ProcessEnv;
    /** 替换模型 provider(对话运行测试用)。 */
    provider?: ModelProvider;
    /** 审批请求的有效期(审批过期测试用)。 */
    approvalTimeoutMs?: number;
    /** web.fetch 的解析器与地址校验(测试中指向本机服务器)。 */
    webFetch?: WebFetchOptions;
}

export async function createTestServer(
    overrides: Partial<AppDeps['config']> = {},
    options: TestServerOptions = {},
): Promise<TestServer> {
    const dir = mkdtempSync(join(tmpdir(), 'aip-server-'));
    const { conn } = await openStorage({ dataDir: dir });
    const repos = createRepositories(conn);
    const logs: string[] = [];
    const destination = new Writable({
        write(chunk: Buffer, _enc, cb) {
            logs.push(chunk.toString('utf8'));
            cb();
        },
    });
    const redactor = new Redactor();
    const secrets = new SecretStore({ dataDir: dir, redactor, env: options.env ?? {} });
    const providerDeps = {
        secrets,
        redactor,
        sleep: () => Promise.resolve(),
        ...(options.fetch ? { fetch: options.fetch } : {}),
    };
    const providerFor = (profile: Parameters<typeof createProvider>[0]) =>
        options.provider ?? createProvider(profile, providerDeps);
    const memory = createMemoryService(repos);
    const items = createItemService({ repos });
    const bus = new EventBus();
    const runs = new RunManager({
        repos,
        bus,
        persistIntervalMs: 0,
        providerFor,
        tools: createToolRegistry(memory, repos, items, options.webFetch ? { webFetch: options.webFetch } : {}),
        redact: (text) => redactor.redact(text),
        ...(options.approvalTimeoutMs ? { approvalTimeoutMs: options.approvalTimeoutMs } : {}),
        summarize: createSummarizer(repos, providerFor),
    });
    // MCP 子进程在 cleanup 时关闭
    const mcp = createMcpControl(runs.tools);
    const embeddings = createEmbeddingService({ repos, providerFor, redact: (text) => redactor.redact(text) });
    const app = createApp({
        mcp,
        embeddings,
        config: {
            sourceUrl: 'https://github.com/CodingLossy/AI-Personal',
            webDir: null,
            cookieSecure: 'auto',
            setupCode: TEST_SETUP_CODE,
            ...overrides,
        },
        repos,
        logger: createLogger({ level: 'debug', destination, redactLine: (l) => redactor.redact(l) }),
        secrets,
        providerDeps,
        bus,
        items,
        redact: (text) => redactor.redact(text),
        runs,
        memory,
        clientIp: (c) => c.req.header('x-test-ip') ?? '127.0.0.1',
        loginLimiter: new FailureLimiter(5, 60_000),
    });
    return {
        app,
        bus,
        runs,
        embeddings,
        dir,
        repos,
        logs,
        async cleanup() {
            mcp.closeAll();
            embeddings.stop();
            await embeddings.idle();
            await runs.idle();
            conn.close();
            rmSync(dir, { recursive: true, force: true });
        },
    };
}

/** 从响应中取出 Set-Cookie,拼成后续请求可用的 Cookie 头,并返回 CSRF 令牌。 */
export function sessionFrom(res: Response): { cookie: string; csrf: string; setCookies: string[] } {
    const setCookies = res.headers.getSetCookie();
    const pairs = setCookies.map((c) => c.split(';')[0]!);
    const csrf = pairs.find((p) => p.startsWith('aip_csrf='))?.slice('aip_csrf='.length) ?? '';
    return { cookie: pairs.join('; '), csrf, setCookies };
}

export const jsonBody = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
});
