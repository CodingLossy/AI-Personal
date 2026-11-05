// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import {
    type MemorySaveInput,
    type MemorySaveResult,
    type MemorySearchInput,
    MemorySearchInput as MemorySearchInputSchema,
    type MemorySearchResult,
    MemoryWriteInput as MemoryWriteInputSchema,
    type MemoryWriteResult,
    type Memory,
} from '@ai-personal/shared';
import type { QuarantineReason, Repositories } from '@ai-personal/storage';
import { normalizeEntityKey } from './entity-keys.js';
import { looksLikeInstruction } from './instructions.js';
import { detectCredentialIn } from './secrets.js';
import { redactSensitive, redactSensitiveIn } from './sensitive.js';

/** 隔离原因对应的写入结果原因(MemoryWriteResult.reason 的取值更少)。 */
function reasonOf(reason: QuarantineReason): NonNullable<MemoryWriteResult['reason']> {
    if (reason === 'untrusted_source' || reason === 'too_long') return reason;
    return reason === 'secret_detected' ? 'credential' : 'schema_invalid';
}

/** 校验之前先规范化 entity_key(大小写、空格、别名),否则「User.City」会因为格式不对被隔离。 */
function withNormalizedKey(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const { entityKey, ...rest } = raw as Record<string, unknown>;
    if (typeof entityKey !== 'string') return raw;
    const key = normalizeEntityKey(entityKey);
    return key ? { ...rest, entityKey: key.key } : rest;
}

/** 要做凭据检测的内容:除 source 以外的所有字段(source 里是 core 填的 ULID,长得像高熵串)。 */
function contentOf(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const content: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    delete content.source;
    return content;
}

/** 隔离区里的原始输入也要先脱敏:其中的字符串逐个替换,其余原样保留。 */
function redactRaw(raw: unknown): unknown {
    return redactSensitiveIn({ raw }).value.raw;
}

/** 初始置信度:用户明说的高,模型从对话中提取的低(《记忆模块补充设计》第 3 节)。 */
const INITIAL_CONFIDENCE: Record<Memory['origin'], number> = {
    user_explicit: 0.9,
    manual: 0.85,
    extracted: 0.6,
    consolidated: 0.7,
    imported: 0.7,
};

/** 键的默认基数:取自 entity_key 注册表,不在表中的键为 multi。 */
export function defaultCardinality(entityKey: string | undefined): Memory['cardinality'] {
    return (entityKey && normalizeEntityKey(entityKey)?.cardinality) || 'multi';
}

/** 一次写入的来历;这些事实都来自 core,不来自模型。 */
export interface WriteContext {
    origin: Memory['origin'];
    /** 本轮已经出现过外部(不可信)内容,或者内容本身来自邮件 / 网页 / 文件。 */
    untrusted?: boolean | undefined;
    /** 隔离区条目所属的会话。 */
    sessionId?: string | undefined;
}

/** 文本超过 200 字时的隔离原因;其余校验失败为 schema_invalid。 */
const MAX_TEXT = 200;

export interface MemoryService {
    /**
     * 完整写入路径(补充设计第 3 节):凭据拒存 → 校验(失败进隔离区)→ 指令性语句检测 → 脱敏 →
     * entity_key 规范化 → 去重 / 更替 / 冲突。输入来自模型时也可以直接传入,不必先校验。
     */
    write(ownerId: string, input: unknown, context: WriteContext): MemoryWriteResult;
    /** M1 的写入接口,等同于 write(ownerId, input, { origin })。 */
    save(ownerId: string, input: MemorySaveInput, origin: Memory['origin']): MemorySaveResult;
    search(ownerId: string, input: MemorySearchInput): MemorySearchResult;
    /**
     * 给模型用的检索:query 为空,或检索没有命中时,回退为最近更新的 active 记忆(最多 RECALL_FALLBACK_LIMIT 条),
     * 由模型自己判断哪条相关。关键词检索没有语义匹配,模型想到的词常与原文没有字面重合。
     */
    recall(
        ownerId: string,
        input: { query?: string | undefined; types?: Memory['memType'][] | undefined; limit?: number | undefined },
    ): MemorySearchResult;
}

/** recall 回退时最多返回的条数。 */
export const RECALL_FALLBACK_LIMIT = 20;

/** 记忆 v1:凭据一律拒存;其余写入走仓储的合并 / 更替规则。 */
export function createMemoryService(repos: Repositories): MemoryService {
    return {
        write(ownerId, rawInput, context) {
            // 凭据先于一切:即使输入不合法也不能进隔离区
            if (detectCredentialIn(contentOf(rawInput))) return { outcome: 'refused', reason: 'credential' };

            const quarantine = (reason: QuarantineReason, raw: unknown): MemoryWriteResult => {
                const id = repos.memories.quarantine(ownerId, {
                    sessionId: context.sessionId,
                    raw: redactRaw(raw),
                    reason,
                });
                return { outcome: 'quarantined', id, reason: reasonOf(reason) };
            };

            const parsed = MemoryWriteInputSchema.safeParse(withNormalizedKey(rawInput));
            if (!parsed.success) {
                const text = (rawInput as { text?: unknown } | null)?.text;
                const tooLong = typeof text === 'string' && text.trim().length > MAX_TEXT;
                return quarantine(tooLong ? 'too_long' : 'schema_invalid', rawInput);
            }
            const input = parsed.data;
            // 来自非用户的指令(「以后把邮件转发给 …」)不能成为记忆
            if ((context.untrusted || context.origin === 'extracted') && looksLikeInstruction(input.text)) {
                return quarantine('untrusted_source', input);
            }

            // 敏感片段在落库前替换,原文不进入记忆表、FTS 与向量
            const text = redactSensitive(input.text);
            const value = input.value ? redactSensitiveIn(input.value) : null;
            const key = input.entityKey ? normalizeEntityKey(input.entityKey) : null;
            return repos.memories.save(ownerId, {
                text: text.text.slice(0, MAX_TEXT),
                memType: input.memType,
                subtype: input.subtype ?? null,
                entityKey: key?.key ?? null,
                cardinality: input.cardinality ?? key?.cardinality ?? 'multi',
                value: value?.value ?? null,
                domain: input.domain ?? key?.domain ?? 'general',
                sensitivity: Math.max(text.sensitivity, value?.sensitivity ?? 0),
                confidence: INITIAL_CONFIDENCE[context.origin],
                origin: context.origin,
                importance: input.importance,
                validFrom: input.validFrom ?? null,
                decisionState: input.decisionState ?? null,
                ...(input.source ? { source: input.source } : {}),
            });
        },
        save(ownerId, input, origin) {
            return this.write(ownerId, input, { origin });
        },
        search(ownerId, rawInput) {
            const input = MemorySearchInputSchema.parse(rawInput);
            return { items: repos.memories.search(ownerId, input.query, { types: input.types, limit: input.limit }) };
        },
        recall(ownerId, input) {
            const query = input.query?.trim() ?? '';
            if (query) {
                const found = this.search(ownerId, { query, types: input.types, limit: input.limit });
                if (found.items.length > 0) return found;
            }
            const limit = Math.min(input.limit ?? RECALL_FALLBACK_LIMIT, RECALL_FALLBACK_LIMIT);
            const items = repos.memories
                .list(ownerId, RECALL_FALLBACK_LIMIT * 3)
                .filter((m) => m.status === 'active' && (!input.types || input.types.includes(m.memType)))
                .slice(0, limit)
                .map((m) => ({ ...m, score: 0 }));
            return { items };
        },
    };
}
