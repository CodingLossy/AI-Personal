// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaResponseSchema } from '@ai-personal/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('server app', () => {
    const app = createApp({ sourceUrl: 'https://github.com/CodingLossy/AI-Personal', webDir: null });

    it('GET /healthz 返回 200', async () => {
        const res = await app.request('/healthz');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ status: 'ok' });
        expect(res.headers.get('X-AIP-Server-Version')).toBeTruthy();
    });

    it('GET /api/v1/meta 返回许可证与源码地址', async () => {
        const app2 = createApp({ sourceUrl: 'https://example.com/src', webDir: null });
        const res = await app2.request('/api/v1/meta');
        expect(res.status).toBe(200);
        const meta = MetaResponseSchema.parse(await res.json());
        expect(meta.license).toBe('AGPL-3.0-only');
        expect(meta.sourceUrl).toBe('https://example.com/src');
    });

    it('未知路径返回 404', async () => {
        const res = await app.request('/nope');
        expect(res.status).toBe(404);
    });

    it('配置 webDir 时托管 Web UI,/api 下未知路径仍为 404', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aip-web-'));
        writeFileSync(join(dir, 'index.html'), '<!doctype html><title>AI-Personal</title>');
        const web = createApp({ sourceUrl: 'https://github.com/CodingLossy/AI-Personal', webDir: dir });

        const page = await web.request('/some/route');
        expect(page.status).toBe(200);
        expect(await page.text()).toContain('AI-Personal');
        expect((await web.request('/api/v1/nope')).status).toBe(404);
        expect((await web.request('/healthz')).status).toBe(200);
    });
});
