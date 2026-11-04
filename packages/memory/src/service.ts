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
import { detectCredential } from './secrets.js';

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
}

/** 记忆 v1:凭据一律拒存;其余写入走仓储的合并 / 更替规则。 */
export function createMemoryService(repos: Repositories): MemoryService {
    return {
        save(ownerId, rawInput, origin) {
            const input = MemorySaveInputSchema.parse(rawInput);
            if (detectCredential(input.text) || (input.value && detectCredential(JSON.stringify(input.value)))) {
                return { outcome: 'refused', reason: 'credential' };
            }
            const result = repos.memories.save(ownerId, {
                text: input.text,
                memType: input.memType,
                subtype: input.subtype ?? null,
                entityKey: input.entityKey ?? null,
                cardinality: input.cardinality ?? defaultCardinality(input.entityKey),
                value: input.value ?? null,
                domain: input.domain ?? 'general',
                sensitivity: 0,
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
    };
}
