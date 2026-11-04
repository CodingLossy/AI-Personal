// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { FsRoot } from '@ai-personal/shared';
import type { Connection } from './db.js';
import { newId } from './ids.js';

/** 授权目录(ADR 0011);路径由调用方规范化(realpath)后传入。 */
export function createFsRootRepository(conn: Connection, now: () => Date) {
    const { sqlite } = conn;
    const COLUMNS = 'id, path, label, created_at AS createdAt';
    const q = {
        list: sqlite.prepare<[string], FsRoot>(
            `SELECT ${COLUMNS} FROM fs_roots WHERE owner_id = ? ORDER BY created_at, id`,
        ),
        get: sqlite.prepare<[string, string], FsRoot>(`SELECT ${COLUMNS} FROM fs_roots WHERE owner_id = ? AND id = ?`),
        insert: sqlite.prepare(
            'INSERT INTO fs_roots (id, owner_id, path, label, created_at) VALUES (@id, @ownerId, @path, @label, @createdAt)',
        ),
        delete: sqlite.prepare<[string, string]>('DELETE FROM fs_roots WHERE owner_id = ? AND id = ?'),
    };
    return {
        list(ownerId: string): FsRoot[] {
            return q.list.all(ownerId);
        },
        get(ownerId: string, id: string): FsRoot | null {
            return q.get.get(ownerId, id) ?? null;
        },
        create(ownerId: string, input: { path: string; label: string }): FsRoot {
            const id = newId(now());
            q.insert.run({ id, ownerId, path: input.path, label: input.label, createdAt: now().toISOString() });
            return q.get.get(ownerId, id)!;
        },
        delete(ownerId: string, id: string): boolean {
            return q.delete.run(ownerId, id).changes > 0;
        },
    };
}
