// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { formatLog } from './log.js';

describe('loadConfig', () => {
    it('默认只监听本机', () => {
        expect(loadConfig({})).toEqual({
            host: '127.0.0.1',
            port: 8787,
            sourceUrl: 'https://github.com/CodingLossy/AI-Personal',
            webDir: null,
        });
    });

    it('可用 AIP_SOURCE_URL 覆盖源码地址', () => {
        expect(loadConfig({ AIP_SOURCE_URL: 'https://example.com/fork' }).sourceUrl).toBe('https://example.com/fork');
    });

    it('拒绝非法端口', () => {
        expect(() => loadConfig({ AIP_PORT: '70000' })).toThrow();
    });
});

describe('formatLog', () => {
    it('输出一行 JSON(time / level / msg + 字段)', () => {
        const line = formatLog('info', 'listening', { port: 8787 }, new Date('2026-11-03T09:05:07.012Z'));
        expect(JSON.parse(line)).toEqual({
            time: '2026-11-03T09:05:07.012Z',
            level: 'info',
            msg: 'listening',
            port: 8787,
        });
    });
});
