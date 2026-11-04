// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 记忆 v1(ADR 0007 的 M1 子集):每条记忆是一个 items 行(source='memory')加一个 memory_facts 行。
// 检索用 items_fts(trigram);少于 3 个字符的查询 trigram 无法命中,回退为 LIKE。
import type { Memory } from '@ai-personal/shared';
import type { Connection } from './db.js';
import { newId } from './ids.js';
import type { ItemRepository } from './items.js';

export interface NewMemory {
    text: string;
    memType: Memory['memType'];
    subtype: Memory['subtype'];
    entityKey: Memory['entityKey'];
    cardinality: Memory['cardinality'];
    value: Memory['value'];
    domain: Memory['domain'];
    sensitivity: number;
    confidence: number;
    origin: Memory['origin'];
    source?: {
        sessionId?: string | undefined;
        userMessageId?: string | undefined;
        answerMessageId?: string | undefined;
        itemId?: string | undefined;
    };
}

interface Row {
    id: string;
    text: string;
    memType: Memory['memType'];
    subtype: Memory['subtype'];
    entityKey: string | null;
    cardinality: Memory['cardinality'];
    valueJson: string | null;
    status: Memory['status'];
    domain: Memory['domain'];
    sensitivity: number;
    confidence: number;
    origin: Memory['origin'];
    tier: NonNullable<Memory['tier']>;
    importance: number;
    pinned: number;
    supersedesId: string | null;
    lastConfirmedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

const SELECT = `SELECT f.item_id AS id, i.summary AS text, f.mem_type AS memType, f.subtype, f.entity_key AS entityKey,
        f.cardinality, f.value_json AS valueJson, f.status, f.domain, f.sensitivity, f.confidence, f.origin,
        f.tier, f.importance, f.pinned, f.supersedes_id AS supersedesId, f.last_confirmed_at AS lastConfirmedAt,
        f.created_at AS createdAt, f.updated_at AS updatedAt
    FROM memory_facts f JOIN items i ON i.id = f.item_id`;

const DOMAIN_TITLES = { work: '工作', life: '生活', general: '通用' } as const;
const GROUP_TITLES = { semantic: '事实', episodic: '经历', procedural: '方法', decision: '决策' } as const;

const TITLE_LENGTH = 40;
const MIN_TRIGRAM_QUERY = 3;

function toMemory(row: Row): Memory {
    return {
        id: row.id,
        text: row.text,
        memType: row.memType,
        subtype: row.subtype,
        entityKey: row.entityKey,
        cardinality: row.cardinality,
        value: row.valueJson === null ? null : (JSON.parse(row.valueJson) as Record<string, unknown>),
        status: row.status,
        domain: row.domain,
        sensitivity: row.sensitivity,
        confidence: row.confidence,
        origin: row.origin,
        tier: row.tier,
        importance: row.importance,
        pinned: row.pinned === 1,
        supersedesId: row.supersedesId,
        lastConfirmedAt: row.lastConfirmedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

/** FTS5 查询串:按空白切词,每个词作为短语加引号,避免用户输入被解析成 FTS 语法。 */
function ftsQuery(query: string): string {
    return query
        .split(/\s+/)
        .filter((w) => w.length >= MIN_TRIGRAM_QUERY)
        .map((w) => `"${w.replace(/"/g, '""')}"`)
        .join(' OR ');
}

export function createMemoryRepository(conn: Connection, now: () => Date, items: ItemRepository) {
    const { sqlite } = conn;
    const iso = () => now().toISOString();

    /** 找到或创建一个记忆类别(ADR 0007 第 5.2 节第 3 条)。 */
    function category(
        ownerId: string,
        ref: string,
        parentId: string | null,
        type: string,
        title: string,
        meta?: Record<string, unknown>,
    ): string {
        const found = items.bySource(ownerId, 'memory', ref);
        if (found) return found.id;
        return items.upsert(ownerId, {
            source: 'memory',
            sourceRef: ref,
            kind: 'category',
            type,
            title,
            icon: parentId ? null : 'brain',
            meta: meta ?? null,
            parentId,
        }).id;
    }

    /** 记忆在导航树中的父类别:记忆 → 域 → 类型(被更替的放进「历史版本」)。 */
    function parentFor(
        ownerId: string,
        m: { domain: Memory['domain']; memType: Memory['memType']; subtype: Memory['subtype']; superseded: boolean },
    ): string {
        const root = category(ownerId, 'memory', null, 'memory', '记忆');
        const domain = category(ownerId, `memory:${m.domain}`, root, 'memory.domain', DOMAIN_TITLES[m.domain]);
        const group = m.subtype === 'decision' ? 'decision' : m.memType;
        const ref = `memory:${m.domain}:${group}`;
        const parent = category(ownerId, ref, domain, 'memory.group', GROUP_TITLES[group]);
        return m.superseded
            ? category(ownerId, `${ref}:history`, parent, 'memory.history', '历史版本', { hidden: true })
            : parent;
    }

    /** 按记忆当前的域、类型与状态重新挂到导航树上。 */
    function place(ownerId: string, row: Row): void {
        items.attach(ownerId, row.id, parentFor(ownerId, { ...row, superseded: row.status === 'superseded' }));
    }

    const q = {
        insertItem: sqlite.prepare(
            `INSERT INTO items (id, owner_id, kind, type, source, title, summary, created_at, updated_at)
             VALUES (@id, @ownerId, 'content', @type, 'memory', @title, @summary, @at, @at)`,
        ),
        insertFact: sqlite.prepare(
            `INSERT INTO memory_facts (item_id, owner_id, mem_type, subtype, entity_key, cardinality, value_json, status,
                                       domain, sensitivity, confidence, origin, created_at, updated_at)
             VALUES (@id, @ownerId, @memType, @subtype, @entityKey, @cardinality, @valueJson, 'active',
                     @domain, @sensitivity, @confidence, @origin, @at, @at)`,
        ),
        insertSource: sqlite.prepare(
            `INSERT INTO memory_sources (id, memory_id, session_id, user_message_id, answer_message_id, source_item_id, created_at)
             VALUES (@id, @memoryId, @sessionId, @userMessageId, @answerMessageId, @itemId, @at)`,
        ),
        get: sqlite.prepare<[string, string], Row>(`${SELECT} WHERE f.owner_id = ? AND f.item_id = ?`),
        list: sqlite.prepare<[string, number], Row>(
            `${SELECT} WHERE f.owner_id = ? AND f.status IN ('active','conflicted') ORDER BY f.updated_at DESC, f.item_id DESC LIMIT ?`,
        ),
        sameText: sqlite.prepare<[string, string, string], Row>(
            `${SELECT} WHERE f.owner_id = ? AND f.mem_type = ? AND f.status = 'active' AND i.summary = ? LIMIT 1`,
        ),
        activeSingle: sqlite.prepare<[string, string], Row>(
            `${SELECT} WHERE f.owner_id = ? AND f.entity_key = ? AND f.cardinality = 'single' AND f.status = 'active'`,
        ),
        setStatus: sqlite.prepare('UPDATE memory_facts SET status = ?, updated_at = ? WHERE item_id = ?'),
        setSupersedes: sqlite.prepare('UPDATE memory_facts SET supersedes_id = ? WHERE item_id = ?'),
        supersedesEdge: sqlite.prepare(
            `INSERT INTO item_edges (parent_id, child_id, rel, position, primary_edge) VALUES (?, ?, 'supersedes', NULL, 0)
             ON CONFLICT DO NOTHING`,
        ),
        confirmedAt: sqlite.prepare('UPDATE memory_facts SET last_confirmed_at = ? WHERE item_id = ?'),
        confirm: sqlite.prepare(
            'UPDATE memory_facts SET confidence = min(0.99, confidence + 0.05), updated_at = ? WHERE item_id = ?',
        ),
        updateText: sqlite.prepare('UPDATE items SET title = ?, summary = ?, updated_at = ? WHERE id = ?'),
        updateDomain: sqlite.prepare('UPDATE memory_facts SET domain = ?, updated_at = ? WHERE item_id = ?'),
        deleteItem: sqlite.prepare("DELETE FROM items WHERE owner_id = ? AND id = ? AND source = 'memory'"),
        fts: sqlite.prepare<[string, string, number], Row & { rank: number }>(
            `${SELECT} JOIN items_fts ON items_fts.rowid = i.rowid
             WHERE items_fts MATCH ? AND f.owner_id = ? AND f.status IN ('active','conflicted') AND i.deleted_at IS NULL
             ORDER BY bm25(items_fts) LIMIT ?`,
        ),
        like: sqlite.prepare<[string, string, number], Row>(
            `${SELECT} WHERE f.owner_id = ? AND f.status IN ('active','conflicted') AND i.summary LIKE ? ESCAPE '\\'
             ORDER BY f.updated_at DESC LIMIT ?`,
        ),
    };

    function insert(ownerId: string, input: NewMemory): string {
        const id = newId(now());
        const at = iso();
        q.insertItem.run({
            id,
            ownerId,
            type: `memory.${input.memType}`,
            title: input.text.slice(0, TITLE_LENGTH),
            summary: input.text,
            at,
        });
        q.insertFact.run({
            id,
            ownerId,
            memType: input.memType,
            subtype: input.subtype,
            entityKey: input.entityKey,
            cardinality: input.cardinality,
            valueJson: input.value === null ? null : JSON.stringify(input.value),
            domain: input.domain,
            sensitivity: input.sensitivity,
            confidence: input.confidence,
            origin: input.origin,
            at,
        });
        if (input.source) {
            q.insertSource.run({
                id: newId(now()),
                memoryId: id,
                sessionId: input.source.sessionId ?? null,
                userMessageId: input.source.userMessageId ?? null,
                answerMessageId: input.source.answerMessageId ?? null,
                itemId: input.source.itemId ?? null,
                at,
            });
        }
        q.confirmedAt.run(at, id);
        items.attach(ownerId, id, parentFor(ownerId, { ...input, superseded: false }));
        return id;
    }

    return {
        /**
         * 写入一条记忆:同类型、同文本的 active 记忆只提高置信度(merged);
         * 单值 entity_key 已有 active 值时,先把旧值标为 superseded 再插入新值(部分唯一索引要求这个顺序,ADR 0007)。
         */
        save(
            ownerId: string,
            input: NewMemory,
        ): { outcome: 'created' | 'merged' | 'superseded'; id: string; supersededId?: string } {
            return sqlite.transaction(() => {
                const duplicate = q.sameText.get(ownerId, input.memType, input.text);
                if (duplicate) {
                    q.confirm.run(iso(), duplicate.id);
                    return { outcome: 'merged' as const, id: duplicate.id };
                }
                let supersededId: string | undefined;
                if (input.entityKey && input.cardinality === 'single') {
                    const old = q.activeSingle.get(ownerId, input.entityKey);
                    if (old) {
                        // 先标旧值再插入新值(部分唯一索引要求这个顺序,ADR 0007 第 2 节第 3 条)
                        q.setStatus.run('superseded', iso(), old.id);
                        place(ownerId, { ...old, status: 'superseded' });
                        supersededId = old.id;
                    }
                }
                const id = insert(ownerId, input);
                if (supersededId) {
                    q.setSupersedes.run(supersededId, id);
                    q.supersedesEdge.run(id, supersededId);
                }
                return supersededId
                    ? { outcome: 'superseded' as const, id, supersededId }
                    : { outcome: 'created' as const, id };
            })();
        },
        get(ownerId: string, id: string): Memory | null {
            const row = q.get.get(ownerId, id);
            return row ? toMemory(row) : null;
        },
        /** active 与 conflicted 的记忆,最近更新的在前。 */
        list(ownerId: string, limit: number): Memory[] {
            return q.list.all(ownerId, limit).map(toMemory);
        },
        update(
            ownerId: string,
            id: string,
            patch: { text?: string; domain?: Memory['domain']; retract?: boolean },
        ): Memory | null {
            if (!q.get.get(ownerId, id)) return null;
            sqlite.transaction(() => {
                const at = iso();
                if (patch.text !== undefined) q.updateText.run(patch.text.slice(0, TITLE_LENGTH), patch.text, at, id);
                if (patch.domain !== undefined) {
                    q.updateDomain.run(patch.domain, at, id);
                    place(ownerId, q.get.get(ownerId, id)!); // 改了域:挂到新域的同类型下
                }
                if (patch.retract) q.setStatus.run('retracted', at, id);
            })();
            return this.get(ownerId, id);
        },
        /**
         * 「忘记」:先从导航树上摘下(扣减祖先计数),再硬删除条目;记忆、出处、反馈、冲突、嵌入与向量
         * 由外键与触发器级联删除,FTS 由触发器同步(ADR 0007 第 5.2 节第 5 条)。
         */
        delete(ownerId: string, id: string): boolean {
            return sqlite.transaction(() => {
                if (!q.get.get(ownerId, id)) return false;
                items.attach(ownerId, id, null);
                return q.deleteItem.run(ownerId, id).changes > 0;
            })();
        },
        /** 检索:能用 trigram 的查询走 FTS5(bm25 排序),否则回退为 LIKE。score 越大越相关。 */
        search(
            ownerId: string,
            query: string,
            options: { types?: Memory['memType'][] | undefined; limit: number },
        ): (Memory & { score: number })[] {
            const match = ftsQuery(query.trim());
            let rows: (Row & { rank?: number })[];
            if (match) {
                rows = q.fts.all(match, ownerId, options.limit * 3);
            } else {
                const escaped = query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
                rows = q.like.all(ownerId, `%${escaped}%`, options.limit * 3);
            }
            return rows
                .filter((r) => !options.types || options.types.includes(r.memType))
                .slice(0, options.limit)
                .map((r, index) => ({ ...toMemory(r), score: Number((1 / (1 + index)).toFixed(4)) }));
        },
    };
}

export interface SessionSummary {
    fromSeq: number;
    toSeq: number;
    summary: string;
}

/** 会话摘要按段保存(from_seq 唯一):每段压缩一段连续的旧消息,原文仍在 messages。 */
export function createSummaryRepository(conn: Connection, now: () => Date) {
    const { sqlite } = conn;
    const q = {
        list: sqlite.prepare<[string], SessionSummary>(
            `SELECT from_seq AS fromSeq, to_seq AS toSeq, summary FROM session_summaries
             WHERE session_id = ? ORDER BY from_seq`,
        ),
        insert: sqlite.prepare(
            `INSERT INTO session_summaries (id, session_id, from_seq, to_seq, summary, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ),
    };
    return {
        list(sessionId: string): SessionSummary[] {
            return q.list.all(sessionId);
        },
        add(sessionId: string, summary: SessionSummary): void {
            q.insert.run(newId(now()), sessionId, summary.fromSeq, summary.toSeq, summary.summary, now().toISOString());
        },
    };
}
