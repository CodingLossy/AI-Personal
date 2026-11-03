// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

type Level = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

function timestamp(date = new Date()): string {
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
    );
}

/**
 * 格式化一行日志:`时间 [级别] [代码位置] {JSON 详情}`。
 * M0 的最小实现,M1 换成 pino 并保持同一格式;日志只写本地,永不外传。
 */
export function formatLog(level: Level, position: string, detail: Record<string, unknown>, date?: Date): string {
    return `${timestamp(date)} [${level}] [${position}] ${JSON.stringify(detail)}`;
}

export function log(level: Level, position: string, detail: Record<string, unknown>): void {
    const line = formatLog(level, position, detail);
    if (level === 'ERROR' || level === 'FATAL') {
        console.error(line);
    } else {
        console.log(line);
    }
}
