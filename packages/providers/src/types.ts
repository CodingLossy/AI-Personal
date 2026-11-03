// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { ModelKind, ModelPurpose, ModelTestResult, ProviderErrorCode, Usage } from '@ai-personal/shared';

/** 模型网关只关心的配置档字段;来自 model_profiles 表(ADR 0006)。 */
export interface ProviderProfile {
    id: string;
    kind: ModelKind;
    baseURL?: string | undefined;
    apiKeyRef: string | null;
    model: string;
    purpose: ModelPurpose[];
    params?: { temperature?: number | undefined; maxOutputTokens?: number | undefined } | undefined;
}

export interface ToolCall {
    callId: string;
    name: string;
    input: unknown;
}

export type ChatMessage =
    | { role: 'system' | 'user'; content: string }
    | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
    | { role: 'tool'; content: string; toolCallId: string };

/** 提供给模型的工具声明;parameters 为 JSON Schema。 */
export interface ToolSpec {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface ChatRequest {
    messages: ChatMessage[];
    tools?: ToolSpec[] | undefined;
    /** 中断:取消后产出 finish { reason: 'aborted' },不抛错。 */
    signal?: AbortSignal | undefined;
}

export type FinishReason = 'stop' | 'length' | 'tool-calls' | 'aborted';

export type ChatChunk =
    | { type: 'text-delta'; delta: string }
    | ({ type: 'tool-call' } & ToolCall)
    | { type: 'finish'; reason: FinishReason; usage?: Usage };

export interface ModelProvider {
    readonly profileId: string;
    /** 流式对话;上游错误以 ProviderError 抛出,错误信息已脱敏。 */
    stream(request: ChatRequest): AsyncIterable<ChatChunk>;
    /** 连接测试,从不抛出。 */
    test(signal?: AbortSignal): Promise<ModelTestResult>;
}

export class ProviderError extends Error {
    override readonly name = 'ProviderError';
    constructor(
        readonly code: ProviderErrorCode,
        message: string,
        readonly status?: number,
    ) {
        super(message);
    }
}
