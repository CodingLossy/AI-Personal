// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { log } from './log.js';

const config = loadConfig();
const app = createApp(config);

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    log('INFO', 'server/index.ts', { service: 'server', event: 'listening', host: info.address, port: info.port });
});

function shutdown(signal: string): void {
    log('INFO', 'server/index.ts', { service: 'server', event: 'shutdown', signal });
    server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
