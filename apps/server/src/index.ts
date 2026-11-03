// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createRepositories, openStorage } from '@ai-personal/storage';
import { createApp } from './app.js';
import { randomToken } from './auth/crypto.js';
import { loadConfig } from './config.js';
import { createLogger } from './log.js';

const config = loadConfig();
const logger = createLogger({ level: config.logLevel });

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const { conn, migrated } = await openStorage({ dataDir: config.dataDir });
if (migrated.applied.length > 0) {
    logger.info({ applied: migrated.applied, backup: migrated.backupPath }, 'database migrated');
}
const repos = createRepositories(conn);

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

const app = createApp({ config: { ...config, setupCode }, repos, logger });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info({ host: info.address, port: info.port, dataDir: config.dataDir }, 'listening');
});

function shutdown(signal: string): void {
    logger.info({ signal }, 'shutdown');
    server.close(() => {
        conn.close();
        process.exit(0);
    });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
