// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { formatLog } from './log.js';

describe('loadConfig', () => {
    it('默认只监听本机', () => {
        expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 8787, sourceUrl: null, webDir: null });
    });

    it('拒绝非法端口', () => {
        expect(() => loadConfig({ AIP_PORT: '70000' })).toThrow();
    });
});

describe('formatLog', () => {
    it('输出 时间 [级别] [位置] {JSON}', () => {
        const line = formatLog('INFO', 'a.ts', { sn: '1' }, new Date(2026, 10, 3, 9, 5, 7, 12));
        expect(line).toBe('2026-11-03 09:05:07.012 [INFO] [a.ts] {"sn":"1"}');
    });
});
