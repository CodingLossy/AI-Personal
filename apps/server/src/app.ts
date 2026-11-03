// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { type HealthResponse, MetaResponseSchema, PROTOCOL_VERSION, SERVER_LICENSE } from '@ai-personal/shared';
import { newId, type Repositories } from '@ai-personal/storage';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
import { authMiddleware } from './auth/middleware.js';
import type { FailureLimiter } from './auth/rate-limit.js';
import type { ServerConfig } from './config.js';
import type { AppEnv } from './env.js';
import { ApiError, handleError, notFound, problemResponse } from './errors.js';
import type { Logger } from './log.js';
import { authRoutes } from './routes/auth.js';
import { json } from './routes/common.js';
import { tokenRoutes } from './routes/tokens.js';
import { SERVER_VERSION } from './version.js';

export interface AppDeps {
    config: Pick<ServerConfig, 'sourceUrl' | 'webDir' | 'cookieSecure' | 'setupCode'>;
    repos: Repositories;
    logger: Logger;
    now?: () => Date;
    /** 请求来源地址;默认取 TCP 对端地址(不信任 X-Forwarded-For)。 */
    clientIp?: (c: Context<AppEnv>) => string;
    loginLimiter?: FailureLimiter;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function tcpPeer(c: Context<AppEnv>): string {
    try {
        return getConnInfo(c).remote.address ?? 'unknown';
    } catch {
        return 'unknown';
    }
}

const metaRoute = createRoute({
    method: 'get',
    path: '/meta',
    tags: ['meta'],
    summary: 'Server version, protocol version, license and source URL (AGPL section 13)',
    responses: { 200: json(MetaResponseSchema, 'Meta') },
});

export function createApp(deps: AppDeps): OpenAPIHono<AppEnv> {
    const { config, repos, logger } = deps;
    const now = deps.now ?? (() => new Date());
    const clientIp = deps.clientIp ?? tcpPeer;
    const app = new OpenAPIHono<AppEnv>();

    app.onError(handleError);

    // 请求 id、版本头与访问日志(只记方法、路径、状态与耗时,不记查询串、请求头或请求体)
    app.use('*', async (c, next) => {
        const incoming = c.req.header('X-Request-Id');
        const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : newId();
        const log = logger.child({ requestId });
        c.set('requestId', requestId);
        c.set('logger', log);
        c.set('auth', null);
        const start = performance.now();
        await next();
        c.header('X-Request-Id', requestId);
        c.header('X-AIP-Server-Version', SERVER_VERSION);
        log.info(
            {
                method: c.req.method,
                path: c.req.path,
                status: c.res.status,
                durationMs: Math.round(performance.now() - start),
            },
            'request',
        );
    });
    app.use('*', secureHeaders({ crossOriginEmbedderPolicy: false }));
    app.use(
        '/api/*',
        bodyLimit({
            maxSize: MAX_BODY_BYTES,
            onError: (c) =>
                problemResponse(c, new ApiError(413, 'validation_failed', 'Payload Too Large', 'Body exceeds 2 MB.')),
        }),
    );
    app.use('/api/v1/*', authMiddleware({ repos, now }));

    app.get('/healthz', (c) => c.json<HealthResponse>({ status: 'ok' }));

    const v1 = new OpenAPIHono<AppEnv>()
        .openapi(metaRoute, (c) =>
            c.json(
                {
                    name: 'AI-Personal' as const,
                    serverVersion: SERVER_VERSION,
                    protocolVersion: PROTOCOL_VERSION,
                    license: SERVER_LICENSE,
                    sourceUrl: config.sourceUrl,
                    capabilities: [],
                },
                200,
            ),
        )
        .route(
            '/',
            authRoutes({
                repos,
                now,
                cookieSecure: config.cookieSecure,
                setupCode: config.setupCode,
                clientIp,
                ...(deps.loginLimiter ? { loginLimiter: deps.loginLimiter } : {}),
            }),
        )
        .route('/', tokenRoutes({ repos, now }));
    app.route('/api/v1', v1);

    // OpenAPI 文档同样需要鉴权(业主决定;CI 另导出静态文件)
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
        type: 'http',
        scheme: 'bearer',
        description: 'Personal access token (aip_pat_...)',
    });
    app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
        type: 'apiKey',
        in: 'cookie',
        name: 'aip_session',
    });
    app.doc31('/api/v1/openapi.json', {
        openapi: '3.1.0',
        info: { title: 'AI-Personal API', version: SERVER_VERSION, license: { name: SERVER_LICENSE } },
        security: [{ bearer: [] }, { session: [] }],
    });

    app.all('/api/*', () => {
        throw notFound('Endpoint');
    });

    if (config.webDir) {
        // 托管 Web UI;非 /api 的未知路径回退到 index.html(前端路由)。
        const spaFallback = serveStatic({ root: config.webDir, path: 'index.html' });
        app.use('/*', serveStatic({ root: config.webDir }));
        app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : spaFallback(c, next)));
    }

    return app;
}
