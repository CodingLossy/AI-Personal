// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 记忆 v1(M1 子集)。命名与取值和《记忆模块补充设计》第 8 节一致,M2 在此基础上扩展(ADR 0007)。
import { z } from 'zod';
import { Id, IsoDateTime } from './common.js';

export const MemType = z.enum(['episodic', 'semantic', 'procedural']);
export type MemType = z.infer<typeof MemType>;

export const MemSubtype = z.enum(['profile', 'preference', 'decision', 'task', 'relation']);
export const MemStatus = z.enum(['active', 'superseded', 'conflicted', 'retracted', 'expired']);
export type MemStatus = z.infer<typeof MemStatus>;

export const MemDomain = z.enum(['work', 'life', 'general']);
export const MemOrigin = z.enum(['user_explicit', 'extracted', 'consolidated', 'manual', 'imported']);
export const MemCardinality = z.enum(['single', 'multi']);

/** 规范化键,如 user.location.city;不在注册表中的键归一为 x.<slug>。 */
export const EntityKey = z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/);

export const MemoryText = z.string().trim().min(2).max(200);

/** memory.save 工具与 POST /api/v1/memory 的输入。 */
export const MemorySaveInput = z.object({
    text: MemoryText,
    memType: MemType.default('semantic'),
    subtype: MemSubtype.optional(),
    entityKey: EntityKey.optional(),
    cardinality: MemCardinality.optional(),
    value: z.record(z.string(), z.unknown()).optional(),
    domain: MemDomain.optional(),
    source: z
        .object({
            sessionId: Id.optional(),
            userMessageId: Id.optional(),
            answerMessageId: Id.optional(),
            itemId: Id.optional(),
        })
        .optional(),
});
export type MemorySaveInput = z.input<typeof MemorySaveInput>;

/** 结果取值与补充设计的 MemoryWriteResult 相同;M1 只会产生 created / merged / superseded / refused。 */
export const MemorySaveResult = z.object({
    outcome: z.enum(['created', 'merged', 'superseded', 'conflicted', 'refused', 'quarantined']),
    id: Id.optional(),
    supersededId: Id.optional(),
    reason: z.enum(['credential', 'schema_invalid', 'untrusted_source', 'too_long']).optional(),
});
export type MemorySaveResult = z.infer<typeof MemorySaveResult>;

export const Memory = z.object({
    id: Id,
    text: MemoryText,
    memType: MemType,
    subtype: MemSubtype.nullable(),
    entityKey: EntityKey.nullable(),
    cardinality: MemCardinality,
    value: z.record(z.string(), z.unknown()).nullable(),
    status: MemStatus,
    domain: MemDomain,
    /** 0 普通、1 个人、2 敏感(已脱敏);凭据一律拒存。 */
    sensitivity: z.number().int().min(0).max(2),
    confidence: z.number().min(0).max(1),
    origin: MemOrigin,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
});
export type Memory = z.infer<typeof Memory>;

/** PATCH /api/v1/memory/:id;只能修正文本与分类,或撤回(retracted)。 */
export const MemoryPatch = z.object({
    text: MemoryText.optional(),
    domain: MemDomain.optional(),
    status: z.literal('retracted').optional(),
});
export type MemoryPatch = z.infer<typeof MemoryPatch>;

/** memory.search 工具与 POST /api/v1/memory/search 的输入。 */
export const MemorySearchInput = z.object({
    query: z.string().trim().min(1).max(500),
    types: z.array(MemType).optional(),
    limit: z.number().int().min(1).max(30).default(12),
});
export type MemorySearchInput = z.input<typeof MemorySearchInput>;

export const MemorySearchResult = z.object({
    items: z.array(Memory.extend({ score: z.number() })),
});
export type MemorySearchResult = z.infer<typeof MemorySearchResult>;
