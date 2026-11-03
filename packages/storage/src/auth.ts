// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 登录会话与个人访问令牌。表中只存令牌的哈希,明文从不落库(ADR 0004 第 2 节)。
import type { AccessToken } from '@ai-personal/shared';
import { and, desc, eq, isNull, lte } from 'drizzle-orm';
import type { Connection } from './db.js';
import { newId } from './ids.js';
import * as t from './schema.js';

export interface AuthSessionRecord {
    id: string;
    ownerId: string;
    csrfHash: string;
    createdAt: string;
    expiresAt: string;
    lastSeenAt: string;
}

export interface AccessTokenRecord {
    id: string;
    ownerId: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
}

function toAccessToken(row: AccessTokenRecord): AccessToken {
    return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        expiresAt: row.expiresAt,
    };
}

export function createAuthRepositories(conn: Connection, now: () => Date) {
    const { db } = conn;
    const iso = () => now().toISOString();

    const authSessions = {
        /** idHash 为会话令牌的 SHA-256。 */
        create(input: { idHash: string; ownerId: string; csrfHash: string; expiresAt: Date }): AuthSessionRecord {
            const at = iso();
            const row = {
                id: input.idHash,
                ownerId: input.ownerId,
                csrfHash: input.csrfHash,
                createdAt: at,
                expiresAt: input.expiresAt.toISOString(),
                lastSeenAt: at,
            };
            db.insert(t.authSessions).values(row).run();
            return row;
        },
        /** 只返回未过期的会话。 */
        getValid(idHash: string): AuthSessionRecord | null {
            return (
                db
                    .select()
                    .from(t.authSessions)
                    .where(eq(t.authSessions.id, idHash))
                    .all()
                    .find((s) => s.expiresAt > iso()) ?? null
            );
        },
        touch(idHash: string, expiresAt: Date): void {
            db.update(t.authSessions)
                .set({ lastSeenAt: iso(), expiresAt: expiresAt.toISOString() })
                .where(eq(t.authSessions.id, idHash))
                .run();
        },
        delete(idHash: string): void {
            db.delete(t.authSessions).where(eq(t.authSessions.id, idHash)).run();
        },
        deleteExpired(): number {
            return db.delete(t.authSessions).where(lte(t.authSessions.expiresAt, iso())).run().changes;
        },
    };

    const accessTokens = {
        create(input: { ownerId: string; name: string; tokenHash: string; expiresAt: Date | null }): AccessToken {
            const row = {
                id: newId(now()),
                ownerId: input.ownerId,
                name: input.name,
                tokenHash: input.tokenHash,
                createdAt: iso(),
                lastUsedAt: null,
                expiresAt: input.expiresAt?.toISOString() ?? null,
                revokedAt: null,
            };
            db.insert(t.accessTokens).values(row).run();
            return toAccessToken(row);
        },
        /** 未吊销的令牌,按创建时间倒序。 */
        list(ownerId: string): AccessToken[] {
            return db
                .select()
                .from(t.accessTokens)
                .where(and(eq(t.accessTokens.ownerId, ownerId), isNull(t.accessTokens.revokedAt)))
                .orderBy(desc(t.accessTokens.createdAt), desc(t.accessTokens.id))
                .all()
                .map(toAccessToken);
        },
        /** 按哈希查找可用令牌(未吊销、未过期)。 */
        findUsable(tokenHash: string): AccessTokenRecord | null {
            const row = db
                .select()
                .from(t.accessTokens)
                .where(and(eq(t.accessTokens.tokenHash, tokenHash), isNull(t.accessTokens.revokedAt)))
                .get();
            if (!row || (row.expiresAt !== null && row.expiresAt <= iso())) return null;
            return row;
        },
        touch(id: string): void {
            db.update(t.accessTokens).set({ lastUsedAt: iso() }).where(eq(t.accessTokens.id, id)).run();
        },
        revoke(ownerId: string, id: string): boolean {
            return (
                db
                    .update(t.accessTokens)
                    .set({ revokedAt: iso() })
                    .where(
                        and(
                            eq(t.accessTokens.ownerId, ownerId),
                            eq(t.accessTokens.id, id),
                            isNull(t.accessTokens.revokedAt),
                        ),
                    )
                    .run().changes > 0
            );
        },
    };

    return { authSessions, accessTokens };
}
