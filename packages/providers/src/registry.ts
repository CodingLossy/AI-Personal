// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { ModelPurpose } from '@ai-personal/shared';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import type { Redactor } from './redact.js';
import type { SecretStore } from './secrets.js';
import { type ModelProvider, ProviderError, type ProviderProfile } from './types.js';

export interface ProviderDeps {
    secrets: SecretStore;
    redactor: Redactor;
    fetch?: typeof fetch;
    firstTokenTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

/** 按配置档创建 provider;密钥在每次请求时才解析。Anthropic / Gemini 原生适配在 M1 最后一个 PR 加入。 */
export function createProvider(profile: ProviderProfile, deps: ProviderDeps): ModelProvider {
    switch (profile.kind) {
        case 'openai-compatible':
            return createOpenAICompatibleProvider({
                profile,
                getApiKey: () => deps.secrets.resolve(profile.apiKeyRef),
                redactor: deps.redactor,
                ...(deps.fetch ? { fetch: deps.fetch } : {}),
                ...(deps.firstTokenTimeoutMs ? { firstTokenTimeoutMs: deps.firstTokenTimeoutMs } : {}),
                ...(deps.sleep ? { sleep: deps.sleep } : {}),
            });
        case 'anthropic':
        case 'gemini':
            return unsupported(profile);
    }
}

function unsupported(profile: ProviderProfile): ModelProvider {
    const message = `${profile.kind} profiles are not supported yet; use an OpenAI-compatible endpoint`;
    return {
        profileId: profile.id,
        // eslint-disable-next-line require-yield
        async *stream() {
            throw new ProviderError('bad_request', message);
        },
        test: () => Promise.resolve({ ok: false, error: 'bad_request', message }),
    };
}

/**
 * 按用途选配置档:优先用设置中的默认值,其次是第一个声明了该用途的配置档;
 * cheap 用途找不到时回退到 chat(ADR 0006)。
 */
export function selectProfile<P extends ProviderProfile>(
    profiles: readonly P[],
    purpose: Extract<ModelPurpose, 'chat' | 'cheap'>,
    defaults: { chat?: string | null; cheap?: string | null } = {},
): P | null {
    const byId = (id: string | null | undefined) => (id ? (profiles.find((p) => p.id === id) ?? null) : null);
    const pick = (p: 'chat' | 'cheap') => byId(defaults[p]) ?? profiles.find((x) => x.purpose.includes(p)) ?? null;
    return purpose === 'cheap' ? (pick('cheap') ?? pick('chat')) : pick('chat');
}
