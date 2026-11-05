// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import {
    type MemorySaveInput,
    type MemorySaveResult,
    MemorySaveInput as MemorySaveInputSchema,
    type MemorySearchInput,
    MemorySearchInput as MemorySearchInputSchema,
    type MemorySearchResult,
    type Memory,
} from '@ai-personal/shared';
import type { Repositories } from '@ai-personal/storage';
import { detectCredential, detectCredentialIn } from './secrets.js';
import { redactSensitive, redactSensitiveIn } from './sensitive.js';

/** 初始置信度:用户明说的高,模型从对话中提取的低(《记忆模块补充设计》第 3 节)。 */
const INITIAL_CONFIDENCE: Record<Memory['origin'], number> = {
    user_explicit: 0.9,
    manual: 0.85,
    extracted: 0.6,
    consolidated: 0.7,
    imported: 0.7,
};

/** 默认为单值的键前缀(画像与偏好类):同一时间只能有一个当前值。M2 换成完整的注册表。 */
const SINGLE_VALUE_PREFIXES = ['user.', 'pref.'];

export function defaultCardinality(entityKey: string | undefined): Memory['cardinality'] {
    return entityKey && SINGLE_VALUE_PREFIXES.some((p) => entityKey.startsWith(p)) ? 'single' : 'multi';
}

export interface MemoryService {
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
        save(ownerId, rawInput, origin) {
            const input = MemorySaveInputSchema.parse(rawInput);
            if (detectCredential(input.text) || detectCredentialIn(input.value)) {
                return { outcome: 'refused', reason: 'credential' };
            }
            // 敏感片段在落库前替换,原文不进入记忆表、FTS 与向量
            const text = redactSensitive(input.text);
            const value = input.value ? redactSensitiveIn(input.value) : null;
            const result = repos.memories.save(ownerId, {
                text: text.text,
                memType: input.memType,
                subtype: input.subtype ?? null,
                entityKey: input.entityKey ?? null,
                cardinality: input.cardinality ?? defaultCardinality(input.entityKey),
                value: value?.value ?? null,
                domain: input.domain ?? 'general',
                sensitivity: Math.max(text.sensitivity, value?.sensitivity ?? 0),
                confidence: INITIAL_CONFIDENCE[origin],
                origin,
                ...(input.source ? { source: input.source } : {}),
            });
            return result;
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
