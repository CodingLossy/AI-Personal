// SPDX-License-Identifier: Apache-2.0
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { z } from 'zod';
import { Id } from './common.js';

export const Locale = z.enum(['zh-CN', 'en']);
export const Theme = z.enum(['system', 'light', 'dark']);

/** GET / PUT /api/v1/settings。PUT 接受部分字段并与现有设置合并。 */
export const Settings = z.object({
    defaultChatProfileId: Id.nullable(),
    /** 上下文压缩等廉价任务用的配置档;为 null 时回退到 chat 配置档(ADR 0006)。 */
    defaultCheapProfileId: Id.nullable(),
    locale: Locale,
    theme: Theme,
    memory: z.object({
        /** 自动从对话中抽取记忆;M1 不实现抽取,默认关闭(M2 决定默认值)。 */
        autoExtract: z.boolean(),
    }),
    /** 本地知识库(ADR 0015)。自 M2 PR 9 起提供。 */
    knowledgeBase: z.object({
        /** 每块的目标字符数;修改后文件在下一次索引时重新分块。 */
        chunkChars: z.number().int().min(200).max(4000),
    }),
});
export type Settings = z.infer<typeof Settings>;

export const SettingsPatch = Settings.partial().extend({
    memory: Settings.shape.memory.partial().optional(),
    knowledgeBase: Settings.shape.knowledgeBase.partial().optional(),
});
export type SettingsPatch = z.infer<typeof SettingsPatch>;

export const DEFAULT_SETTINGS: Settings = {
    defaultChatProfileId: null,
    defaultCheapProfileId: null,
    locale: 'zh-CN',
    theme: 'system',
    memory: { autoExtract: false },
    knowledgeBase: { chunkChars: 1000 },
};
