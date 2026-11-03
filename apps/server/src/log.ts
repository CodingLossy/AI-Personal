// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

type Level = 'debug' | 'info' | 'warn' | 'error';

/**
 * 输出一行 JSON 日志(与 pino 的字段约定一致,M1 换成 pino)。日志只写本地,永不外传。
 */
export function formatLog(level: Level, msg: string, fields: Record<string, unknown> = {}, date = new Date()): string {
    return JSON.stringify({ time: date.toISOString(), level, msg, ...fields });
}

export function log(level: Level, msg: string, fields?: Record<string, unknown>): void {
    const line = formatLog(level, msg, fields);
    if (level === 'error') {
        console.error(line);
    } else {
        console.log(line);
    }
}
