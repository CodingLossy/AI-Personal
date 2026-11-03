// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import Database from 'better-sqlite3';

export type Sqlite = Database.Database;

export interface Connection {
    sqlite: Sqlite;
    close(): void;
}

export class StorageError extends Error {
    override readonly name = 'StorageError';
}

/**
 * 每个连接都必须执行的 PRAGMA(ADR 0005 第 2 节)。
 * foreign_keys 在事务内修改无效,所以只能在连接刚打开、尚无事务时设置。
 */
export function applyPragmas(sqlite: Sqlite): void {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    if (!sqlite.memory) {
        sqlite.pragma('journal_mode = WAL');
    }
    sqlite.pragma('synchronous = NORMAL');
    assertForeignKeysOn(sqlite);
}

export function assertForeignKeysOn(sqlite: Sqlite): void {
    const value = sqlite.pragma('foreign_keys', { simple: true });
    if (value !== 1) {
        throw new StorageError(`PRAGMA foreign_keys must be 1, got ${String(value)}`);
    }
}

/** 打开数据库(文件路径或 ':memory:'),设置并校验 PRAGMA。 */
export function openDatabase(path: string): Connection {
    const sqlite = new Database(path);
    try {
        applyPragmas(sqlite);
    } catch (error) {
        sqlite.close();
        throw error;
    }
    return { sqlite, close: () => sqlite.close() };
}
