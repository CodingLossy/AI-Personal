// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { serveStatic } from '@hono/node-server/serve-static';
import { type HealthResponse, type MetaResponse, PROTOCOL_VERSION, SERVER_LICENSE } from '@ai-personal/shared';
import { Hono } from 'hono';
import type { ServerConfig } from './config.js';
import { SERVER_VERSION } from './version.js';

export function createApp(config: Pick<ServerConfig, 'sourceUrl' | 'webDir'>): Hono {
    const app = new Hono();

    app.use('*', async (c, next) => {
        await next();
        c.header('X-AIP-Server-Version', SERVER_VERSION);
    });

    app.get('/healthz', (c) => c.json<HealthResponse>({ status: 'ok' }));

    app.get('/api/v1/meta', (c) =>
        c.json<MetaResponse>({
            name: 'AI-Personal',
            serverVersion: SERVER_VERSION,
            protocolVersion: PROTOCOL_VERSION,
            license: SERVER_LICENSE,
            sourceUrl: config.sourceUrl,
            capabilities: [],
        }),
    );

    if (config.webDir) {
        // 托管 Web UI;非 /api 的未知路径回退到 index.html(前端路由),/api 下的未知路径仍返回 404。
        const spaFallback = serveStatic({ root: config.webDir, path: 'index.html' });
        app.use('/*', serveStatic({ root: config.webDir }));
        app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : spaFallback(c, next)));
    }

    return app;
}
