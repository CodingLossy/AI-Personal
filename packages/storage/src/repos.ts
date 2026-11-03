// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type {
    AgentEvent,
    EventEnvelope,
    Message,
    MessagePart,
    MessageRole,
    MessageStatus,
    Run,
    RunStatus,
    Session,
    Usage,
} from '@ai-personal/shared';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, max, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { decodeCursor, encodeCursor, type Page } from './cursor.js';
import type { Connection } from './db.js';
import { newId } from './ids.js';
import * as t from './schema.js';

export interface RepoOptions {
    now?: () => Date;
}

export interface AppendMessageInput {
    role: MessageRole;
    parts: MessagePart[];
    status: MessageStatus;
    runId?: string | null | undefined;
    parentMessageId?: string | null | undefined;
    modelProfileId?: string | null | undefined;
    clientMessageId?: string | null | undefined;
}

export interface PageRequest {
    cursor?: string | undefined;
    limit: number;
}

const TERMINAL_RUN_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled'];

const sessionCursor = z.object({ u: z.string(), id: z.string() });
const seqCursor = z.object({ s: z.number().int() });

function parseJson<T>(value: string | null): T | null {
    return value === null ? null : (JSON.parse(value) as T);
}

/** 各领域仓储的统一入口;其他包只通过这里访问数据库(ADR 0005)。 */
export function createRepositories(conn: Connection, options: RepoOptions = {}) {
    const { db, sqlite } = conn;
    const now = options.now ?? (() => new Date());
    const iso = () => now().toISOString();

    // ---------- owners ----------
    const owners = {
        count(): number {
            return (
                db
                    .select({ n: sql<number>`count(*)` })
                    .from(t.owners)
                    .get()?.n ?? 0
            );
        },
        create(input: { username: string; passwordHash: string }) {
            const at = iso();
            const row = { id: newId(now()), ...input, createdAt: at, updatedAt: at };
            db.insert(t.owners).values(row).run();
            return { id: row.id, username: row.username, createdAt: at };
        },
        get(id: string) {
            return db.select().from(t.owners).where(eq(t.owners.id, id)).get() ?? null;
        },
        getByUsername(username: string) {
            return db.select().from(t.owners).where(eq(t.owners.username, username)).get() ?? null;
        },
    };

    // ---------- sessions ----------
    const activeRunId = sql<string | null>`(
        SELECT r.id FROM runs r
        WHERE r.session_id = "sessions"."id" AND r.finished_at IS NULL
        ORDER BY r.started_at DESC LIMIT 1
    )`;

    function toSession(row: typeof t.sessions.$inferSelect & { activeRunId: string | null }): Session {
        return {
            id: row.id,
            title: row.title,
            modelProfileId: row.modelProfileId,
            forkedFromSessionId: row.forkedFromSessionId,
            forkedFromMessageId: row.forkedFromMessageId,
            lastMessageAt: row.lastMessageAt,
            activeRunId: row.activeRunId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    const sessionColumns = { ...getColumns(t.sessions), activeRunId };

    const sessions = {
        create(
            ownerId: string,
            input: { title?: string | undefined; modelProfileId?: string | undefined } = {},
        ): Session {
            const at = iso();
            const id = newId(now());
            db.insert(t.sessions)
                .values({
                    id,
                    ownerId,
                    title: input.title ?? '',
                    modelProfileId: input.modelProfileId ?? null,
                    createdAt: at,
                    updatedAt: at,
                })
                .run();
            return sessions.get(ownerId, id)!;
        },
        get(ownerId: string, id: string): Session | null {
            const row = db
                .select(sessionColumns)
                .from(t.sessions)
                .where(and(eq(t.sessions.ownerId, ownerId), eq(t.sessions.id, id)))
                .get();
            return row ? toSession(row) : null;
        },
        /** 按 updatedAt 倒序;游标为最后一项的 (updatedAt, id)。 */
        list(ownerId: string, page: PageRequest): Page<Session> {
            const after = page.cursor ? decodeCursor(page.cursor, sessionCursor) : null;
            const rows = db
                .select(sessionColumns)
                .from(t.sessions)
                .where(
                    and(
                        eq(t.sessions.ownerId, ownerId),
                        after
                            ? or(
                                  lt(t.sessions.updatedAt, after.u),
                                  and(eq(t.sessions.updatedAt, after.u), lt(t.sessions.id, after.id)),
                              )
                            : undefined,
                    ),
                )
                .orderBy(desc(t.sessions.updatedAt), desc(t.sessions.id))
                .limit(page.limit + 1)
                .all();
            const items = rows.slice(0, page.limit).map(toSession);
            const last = items.at(-1);
            return {
                items,
                nextCursor: rows.length > page.limit && last ? encodeCursor({ u: last.updatedAt, id: last.id }) : null,
            };
        },
        update(
            ownerId: string,
            id: string,
            patch: { title?: string | undefined; modelProfileId?: string | null | undefined },
        ): Session | null {
            const values: Partial<typeof t.sessions.$inferInsert> = { updatedAt: iso() };
            if (patch.title !== undefined) values.title = patch.title;
            if (patch.modelProfileId !== undefined) values.modelProfileId = patch.modelProfileId;
            db.update(t.sessions)
                .set(values)
                .where(and(eq(t.sessions.ownerId, ownerId), eq(t.sessions.id, id)))
                .run();
            return sessions.get(ownerId, id);
        },
        /** 删除会话;消息、运行、事件、摘要由外键级联删除。 */
        delete(ownerId: string, id: string): boolean {
            const result = db
                .delete(t.sessions)
                .where(and(eq(t.sessions.ownerId, ownerId), eq(t.sessions.id, id)))
                .run();
            return result.changes > 0;
        },
    };

    // ---------- messages ----------
    function toMessage(row: typeof t.messages.$inferSelect): Message {
        return {
            id: row.id,
            sessionId: row.sessionId,
            seq: row.seq,
            role: row.role,
            parts: parseJson<MessagePart[]>(row.partsJson) ?? [],
            status: row.status,
            runId: row.runId,
            parentMessageId: row.parentMessageId,
            modelProfileId: row.modelProfileId,
            usage: parseJson<Usage>(row.usageJson),
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }

    const appendMessage = sqlite.transaction(
        (ownerId: string, sessionId: string, input: AppendMessageInput): Message => {
            const at = iso();
            const next =
                (db
                    .select({ s: max(t.messages.seq) })
                    .from(t.messages)
                    .where(eq(t.messages.sessionId, sessionId))
                    .get()?.s ?? 0) + 1;
            const id = newId(now());
            db.insert(t.messages)
                .values({
                    id,
                    sessionId,
                    ownerId,
                    seq: next,
                    role: input.role,
                    partsJson: JSON.stringify(input.parts),
                    status: input.status,
                    runId: input.runId ?? null,
                    parentMessageId: input.parentMessageId ?? null,
                    modelProfileId: input.modelProfileId ?? null,
                    clientMessageId: input.clientMessageId ?? null,
                    createdAt: at,
                    updatedAt: at,
                })
                .run();
            db.update(t.sessions).set({ lastMessageAt: at, updatedAt: at }).where(eq(t.sessions.id, sessionId)).run();
            return toMessage(db.select().from(t.messages).where(eq(t.messages.id, id)).get()!);
        },
    );

    const messages = {
        /** 追加消息:seq 在同一事务内取「当前最大值 + 1」,并更新会话的 lastMessageAt。 */
        append(ownerId: string, sessionId: string, input: AppendMessageInput): Message {
            return appendMessage(ownerId, sessionId, input);
        },
        get(ownerId: string, id: string): Message | null {
            const row = db
                .select()
                .from(t.messages)
                .where(and(eq(t.messages.ownerId, ownerId), eq(t.messages.id, id)))
                .get();
            return row ? toMessage(row) : null;
        },
        findByClientMessageId(sessionId: string, clientMessageId: string): Message | null {
            const row = db
                .select()
                .from(t.messages)
                .where(and(eq(t.messages.sessionId, sessionId), eq(t.messages.clientMessageId, clientMessageId)))
                .get();
            return row ? toMessage(row) : null;
        },
        update(
            id: string,
            patch: {
                parts?: MessagePart[];
                status?: MessageStatus;
                usage?: Usage | null;
                runId?: string | null;
            },
        ): void {
            const values: Partial<typeof t.messages.$inferInsert> = { updatedAt: iso() };
            if (patch.parts !== undefined) values.partsJson = JSON.stringify(patch.parts);
            if (patch.status !== undefined) values.status = patch.status;
            if (patch.usage !== undefined) values.usageJson = patch.usage === null ? null : JSON.stringify(patch.usage);
            if (patch.runId !== undefined) values.runId = patch.runId;
            db.update(t.messages).set(values).where(eq(t.messages.id, id)).run();
        },
        /** 按 seq 升序;游标为最后一项的 seq。 */
        list(ownerId: string, sessionId: string, page: PageRequest): Page<Message> {
            const after = page.cursor ? decodeCursor(page.cursor, seqCursor) : null;
            const rows = db
                .select()
                .from(t.messages)
                .where(
                    and(
                        eq(t.messages.ownerId, ownerId),
                        eq(t.messages.sessionId, sessionId),
                        after ? gt(t.messages.seq, after.s) : undefined,
                    ),
                )
                .orderBy(asc(t.messages.seq))
                .limit(page.limit + 1)
                .all();
            const items = rows.slice(0, page.limit).map(toMessage);
            const last = items.at(-1);
            return { items, nextCursor: rows.length > page.limit && last ? encodeCursor({ s: last.seq }) : null };
        },
    };

    // ---------- runs ----------
    function toRun(row: typeof t.runs.$inferSelect): Run {
        return {
            id: row.id,
            sessionId: row.sessionId,
            status: row.status,
            inputMessageId: row.inputMessageId,
            outputMessageId: row.outputMessageId,
            startedAt: row.startedAt,
            finishedAt: row.finishedAt,
        };
    }

    const runs = {
        create(ownerId: string, input: { sessionId: string; inputMessageId: string }): Run {
            const id = newId(now());
            db.insert(t.runs)
                .values({ id, ownerId, ...input, status: 'queued', startedAt: iso() })
                .run();
            return toRun(db.select().from(t.runs).where(eq(t.runs.id, id)).get()!);
        },
        get(ownerId: string, id: string): Run | null {
            const row = db
                .select()
                .from(t.runs)
                .where(and(eq(t.runs.ownerId, ownerId), eq(t.runs.id, id)))
                .get();
            return row ? toRun(row) : null;
        },
        /** 进入 succeeded / failed / cancelled 时写入 finishedAt。 */
        setStatus(
            id: string,
            status: RunStatus,
            extra: { outputMessageId?: string | null; error?: unknown } = {},
        ): void {
            const values: Partial<typeof t.runs.$inferInsert> = { status };
            if (TERMINAL_RUN_STATUSES.includes(status)) values.finishedAt = iso();
            if (extra.outputMessageId !== undefined) values.outputMessageId = extra.outputMessageId;
            if (extra.error !== undefined) values.errorJson = JSON.stringify(extra.error);
            db.update(t.runs).set(values).where(eq(t.runs.id, id)).run();
        },
        listActive(ownerId: string): Run[] {
            return db
                .select()
                .from(t.runs)
                .where(and(eq(t.runs.ownerId, ownerId), isNull(t.runs.finishedAt)))
                .orderBy(asc(t.runs.startedAt))
                .all()
                .map(toRun);
        },
    };

    // ---------- events ----------
    function toEnvelope(row: typeof t.events.$inferSelect): EventEnvelope {
        return {
            seq: row.seq,
            at: row.createdAt,
            sessionId: row.sessionId,
            event: JSON.parse(row.payloadJson) as AgentEvent,
        };
    }

    const events = {
        /** 持久化事件并返回带全局 seq 的信封(ADR 0004)。 */
        append(
            ownerId: string,
            input: { sessionId: string | null; runId: string | null; event: AgentEvent },
        ): EventEnvelope {
            const row = db
                .insert(t.events)
                .values({
                    ownerId,
                    sessionId: input.sessionId,
                    runId: input.runId,
                    type: input.event.type,
                    payloadJson: JSON.stringify(input.event),
                    createdAt: iso(),
                })
                .returning()
                .get();
            return toEnvelope(row);
        },
        /** 某 owner 在 afterSeq 之后的事件(WebSocket 补发)。 */
        listAfter(ownerId: string, afterSeq: number, limit: number): EventEnvelope[] {
            return db
                .select()
                .from(t.events)
                .where(and(eq(t.events.ownerId, ownerId), gt(t.events.seq, afterSeq)))
                .orderBy(asc(t.events.seq))
                .limit(limit)
                .all()
                .map(toEnvelope);
        },
        /** 某次运行在 afterSeq 之后的事件(SSE 续看)。 */
        listRunAfter(ownerId: string, runId: string, afterSeq: number, limit: number): EventEnvelope[] {
            return db
                .select()
                .from(t.events)
                .where(and(eq(t.events.ownerId, ownerId), eq(t.events.runId, runId), gt(t.events.seq, afterSeq)))
                .orderBy(asc(t.events.seq))
                .limit(limit)
                .all()
                .map(toEnvelope);
        },
        latestSeq(ownerId: string): number {
            return (
                db
                    .select({ s: max(t.events.seq) })
                    .from(t.events)
                    .where(eq(t.events.ownerId, ownerId))
                    .get()?.s ?? 0
            );
        },
        /** 最早仍可补发的 seq;小于它的请求无法完整补发。 */
        oldestSeq(ownerId: string): number | null {
            const row = db
                .select({ s: sql<number | null>`min(${t.events.seq})` })
                .from(t.events)
                .where(eq(t.events.ownerId, ownerId))
                .get();
            return row?.s ?? null;
        },
        /**
         * 删除已结束且早于 finishedBefore 的运行的 text-delta 事件(正文已完整保存在 messages,ADR 0005 第 6 节)。
         * 返回删除的行数。
         */
        compact(finishedBefore: Date): number {
            const oldRuns = db
                .select({ id: t.runs.id })
                .from(t.runs)
                .where(lte(t.runs.finishedAt, finishedBefore.toISOString()));
            return db
                .delete(t.events)
                .where(and(eq(t.events.type, 'text-delta'), inArray(t.events.runId, oldRuns)))
                .run().changes;
        },
    };

    return { owners, sessions, messages, runs, events };
}

export type Repositories = ReturnType<typeof createRepositories>;

function getColumns<T extends typeof t.sessions>(table: T) {
    return {
        id: table.id,
        ownerId: table.ownerId,
        title: table.title,
        modelProfileId: table.modelProfileId,
        forkedFromSessionId: table.forkedFromSessionId,
        forkedFromMessageId: table.forkedFromMessageId,
        lastMessageAt: table.lastMessageAt,
        createdAt: table.createdAt,
        updatedAt: table.updatedAt,
    };
}
