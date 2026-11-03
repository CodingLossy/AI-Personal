// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 仅供测试使用(不参与构建)。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createRepositories, openStorage, type Repositories } from '@ai-personal/storage';
import { createApp, type AppDeps } from './app.js';
import { FailureLimiter } from './auth/rate-limit.js';
import { createLogger } from './log.js';

export const TEST_PASSWORD = 'correct horse battery staple';
export const TEST_SETUP_CODE = 'setup-code-123456';

export interface TestServer {
    app: ReturnType<typeof createApp>;
    repos: Repositories;
    /** 本测试期间写出的全部日志行。 */
    logs: string[];
    cleanup(): void;
}

/**
 * 真实 SQLite 文件 + 完整应用。请求头 x-test-ip 模拟 TCP 对端地址(默认 127.0.0.1)。
 */
export async function createTestServer(overrides: Partial<AppDeps['config']> = {}): Promise<TestServer> {
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
    const app = createApp({
        config: {
            sourceUrl: 'https://github.com/CodingLossy/AI-Personal',
            webDir: null,
            cookieSecure: 'auto',
            setupCode: TEST_SETUP_CODE,
            ...overrides,
        },
        repos,
        logger: createLogger({ level: 'debug', destination }),
        clientIp: (c) => c.req.header('x-test-ip') ?? '127.0.0.1',
        loginLimiter: new FailureLimiter(5, 60_000),
    });
    return {
        app,
        repos,
        logs,
        cleanup() {
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
