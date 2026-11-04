// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { EventBus, RunManager } from '@ai-personal/agent';
import { createItemService } from '@ai-personal/items';
import { createMemoryService } from '@ai-personal/memory';
import { createProvider, Redactor, SecretStore } from '@ai-personal/providers';
import { createRepositories, openStorage } from '@ai-personal/storage';
import { createSummarizer, createToolRegistry } from './agent-setup.js';
import { createApp } from './app.js';
import { randomToken } from './auth/crypto.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';
import { attachWebSocket } from './ws.js';

const config = loadConfig();
// 脱敏器登记本进程加载过的模型密钥;日志每一行写出前都经过它(ADR 0006)
const redactor = new Redactor();
const logger = createLogger({ level: config.logLevel, redactLine: (line) => redactor.redact(line) });

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const { conn, migrated } = await openStorage({ dataDir: config.dataDir });
if (migrated.applied.length > 0) {
    logger.info({ applied: migrated.applied, backup: migrated.backupPath }, 'database migrated');
}
const repos = createRepositories(conn);
const secrets = new SecretStore({ dataDir: config.dataDir, redactor, onWarning: (msg) => logger.warn(msg) });

// 尚未初始化时,生成一次性设置码供非本机完成初始化;本机直连无需设置码(ADR 0004 第 2 节)
let setupCode = config.setupCode;
if (repos.owners.count() === 0) {
    if (setupCode === null) {
        setupCode = randomToken(9);
        // 设置码只在初始化前有效,打印到本地日志是有意为之,便于部署者从容器日志中读取
        logger.warn({ code: setupCode }, 'owner account not created yet; use this one-time setup code');
    } else {
        logger.warn('owner account not created yet; use the setup code from AIP_SETUP_CODE');
    }
}

const providerDeps = { secrets, redactor };
const providerFor = (profile: Parameters<typeof createProvider>[0]) => createProvider(profile, providerDeps);
const memory = createMemoryService(repos);
const items = createItemService({
    repos,
    onError: (err, { provider }) => logger.warn({ err, provider }, 'item provider sync failed'),
});
const bus = new EventBus();
const runs = new RunManager({
    repos,
    bus,
    providerFor,
    tools: createToolRegistry(memory, repos, items),
    redact: (text) => redactor.redact(text),
    summarize: createSummarizer(repos, providerFor),
    onError: (err, { runId }) => logger.error({ err, runId }, 'run failed unexpectedly'),
});
const interrupted = runs.recoverInterrupted();
if (interrupted > 0) logger.warn({ count: interrupted }, 'marked runs interrupted by the previous shutdown as failed');

const app = createApp({
    config: { ...config, setupCode },
    repos,
    logger,
    secrets,
    providerDeps,
    bus,
    runs,
    memory,
    items,
    redact: (text) => redactor.redact(text),
});

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info({ host: info.address, port: info.port, dataDir: config.dataDir }, 'listening');
}) as Server;
const websockets = attachWebSocket(server, { repos, bus, logger });

function shutdown(signal: string): void {
    logger.info({ signal }, 'shutdown');
    websockets.close();
    server.close(() => {
        conn.close();
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
