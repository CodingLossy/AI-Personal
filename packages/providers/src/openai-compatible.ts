// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// OpenAI 兼容端点(OpenAI、DeepSeek、Ollama、LM Studio、vLLM 等)的流式实现。
// 只用 fetch 与 ReadableStream,不引入 SDK:AI SDK 7 加载即增加约 22 MiB RSS,而 2GB 机器的空闲预算只有 120 MiB(ADR 0006)。
import type { ModelTestResult, ProviderErrorCode, Usage } from '@ai-personal/shared';
import { type Redactor, sanitizeUpstreamText } from './redact.js';
import {
    type ChatChunk,
    type ChatMessage,
    type ChatRequest,
    type FinishReason,
    type ModelProvider,
    ProviderError,
    type ProviderProfile,
} from './types.js';

export interface OpenAICompatibleOptions {
    profile: ProviderProfile;
    /** 每次请求时取密钥明文;返回 null 表示不带 Authorization。 */
    getApiKey: () => string | null;
    redactor: Redactor;
    fetch?: typeof fetch;
    /** 首个数据块的超时,默认 60 秒。 */
    firstTokenTimeoutMs?: number;
    /** 连接测试超时,默认 15 秒。 */
    testTimeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRY_WAIT_MS = 10_000;

export function classifyStatus(status: number): ProviderErrorCode {
    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 404) return 'not_found';
    if (status === 429) return 'rate_limited';
    if (status === 408) return 'timeout';
    if (status >= 400 && status < 500) return 'bad_request';
    return 'upstream_error';
}

/**
 * OpenAI 协议要求函数名匹配 ^[a-zA-Z0-9_-]{1,64}$,而我们的工具名带点号(如 memory.save)。
 * 发送前把不允许的字符替换为 "__",收到工具调用时再按本次请求的映射还原。
 */
export function toWireToolName(name: string): string {
    return name.replace(/[^A-Za-z0-9_-]/g, '__').slice(0, 64);
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
    switch (m.role) {
        case 'assistant':
            return m.toolCalls?.length
                ? {
                      role: 'assistant',
                      content: m.content || null,
                      tool_calls: m.toolCalls.map((c) => ({
                          id: c.callId,
                          type: 'function',
                          function: { name: toWireToolName(c.name), arguments: JSON.stringify(c.input ?? {}) },
                      })),
                  }
                : { role: 'assistant', content: m.content };
        case 'tool':
            return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
        default:
            return { role: m.role, content: m.content };
    }
}

function mapFinish(reason: unknown): FinishReason | null {
    switch (reason) {
        case 'stop':
            return 'stop';
        case 'length':
            return 'length';
        case 'tool_calls':
        case 'function_call':
            return 'tool-calls';
        default:
            return reason === null || reason === undefined ? null : 'stop';
    }
}

function mapUsage(raw: unknown): Usage | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const u = raw as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
    const n = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);
    const usage: Usage = {};
    const input = n(u.prompt_tokens);
    const output = n(u.completion_tokens);
    const total = n(u.total_tokens);
    if (input !== undefined) usage.inputTokens = input;
    if (output !== undefined) usage.outputTokens = output;
    if (total !== undefined) usage.totalTokens = total;
    return Object.keys(usage).length > 0 ? usage : undefined;
}

/** 按 SSE 规则把字节流切成 data 负载;忽略注释与其他字段。 */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    let buffer = '';
    let data: string[] = [];
    const reader = body.getReader();
    try {
        for (;;) {
            const { value, done } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            let newline: number;
            while ((newline = buffer.search(/\r?\n/)) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(buffer[newline] === '\r' ? newline + 2 : newline + 1);
                if (line === '') {
                    if (data.length > 0) yield data.join('\n');
                    data = [];
                } else if (line.startsWith('data:')) {
                    data.push(line.slice(5).replace(/^ /, ''));
                }
            }
            if (done) {
                if (buffer.startsWith('data:')) data.push(buffer.slice(5).replace(/^ /, ''));
                if (data.length > 0) yield data.join('\n');
                return;
            }
        }
    } finally {
        reader.releaseLock();
    }
}

interface PendingToolCall {
    id: string;
    name: string;
    args: string;
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): ModelProvider {
    const { profile, redactor } = options;
    const doFetch = options.fetch ?? globalThis.fetch;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const now = options.now ?? Date.now;
    const firstTokenTimeoutMs = options.firstTokenTimeoutMs ?? 60_000;
    if (!profile.baseURL) throw new ProviderError('bad_request', 'baseURL is required for openai-compatible profiles');
    const base = profile.baseURL.replace(/\/+$/, '');

    function headers(): Record<string, string> {
        const h: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
        const key = options.getApiKey();
        if (key) h.authorization = `Bearer ${key}`;
        return h;
    }

    async function errorFrom(res: Response): Promise<ProviderError> {
        let text = '';
        try {
            text = await res.text();
        } catch {
            // 忽略读取失败
        }
        const detail = sanitizeUpstreamText(redactor, text);
        return new ProviderError(
            classifyStatus(res.status),
            `upstream returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
            res.status,
        );
    }

    function networkError(error: unknown): ProviderError {
        const message = error instanceof Error ? error.message : String(error);
        return new ProviderError('network_error', `request failed: ${sanitizeUpstreamText(redactor, message)}`);
    }

    /** 发起请求;只在尚未收到任何响应数据时,对连接错误与 429 / 5xx 退避重试一次。 */
    async function open(body: unknown, signal: AbortSignal): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            let res: Response;
            try {
                res = await doFetch(`${base}/chat/completions`, {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify(body),
                    signal,
                });
            } catch (error) {
                if (signal.aborted) throw error;
                if (attempt === 0) {
                    await sleep(1000);
                    continue;
                }
                throw networkError(error);
            }
            if (res.ok) return res;
            if (attempt === 0 && RETRY_STATUSES.has(res.status)) {
                const retryAfter = Number(res.headers.get('retry-after'));
                await res.body?.cancel().catch(() => undefined);
                await sleep(
                    Number.isFinite(retryAfter) && retryAfter > 0
                        ? Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS)
                        : 1000,
                );
                continue;
            }
            throw await errorFrom(res);
        }
    }

    async function* stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
        const controller = new AbortController();
        const userSignal = request.signal;
        const onAbort = () => controller.abort(userSignal?.reason);
        if (userSignal?.aborted) {
            yield { type: 'finish', reason: 'aborted' };
            return;
        }
        userSignal?.addEventListener('abort', onAbort, { once: true });
        let timedOut = false;
        let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error('first token timeout'));
        }, firstTokenTimeoutMs);
        const clearTimer = () => {
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
        };

        const body: Record<string, unknown> = {
            model: profile.model,
            messages: request.messages.map(toWireMessage),
            stream: true,
            stream_options: { include_usage: true },
        };
        const toolNames = new Map<string, string>();
        if (request.tools?.length) {
            body.tools = request.tools.map((t) => {
                const wire = toWireToolName(t.name);
                toolNames.set(wire, t.name);
                return {
                    type: 'function',
                    function: { name: wire, description: t.description, parameters: t.parameters },
                };
            });
        }
        if (profile.params?.temperature !== undefined) body.temperature = profile.params.temperature;
        if (profile.params?.maxOutputTokens !== undefined) body.max_tokens = profile.params.maxOutputTokens;

        const pending = new Map<number, PendingToolCall>();
        let finish: FinishReason | null = null;
        let usage: Usage | undefined;

        try {
            const res = await open(body, controller.signal);
            if (!res.body) throw new ProviderError('upstream_error', 'upstream returned an empty body');
            for await (const data of sseData(res.body)) {
                clearTimer();
                if (data.trim() === '[DONE]') break;
                let json: {
                    choices?: {
                        delta?: {
                            content?: string | null;
                            tool_calls?: {
                                index?: number;
                                id?: string;
                                function?: { name?: string; arguments?: string };
                            }[];
                        };
                        finish_reason?: string | null;
                    }[];
                    usage?: unknown;
                    error?: { message?: string };
                };
                try {
                    json = JSON.parse(data) as typeof json;
                } catch {
                    throw new ProviderError('upstream_error', 'upstream sent malformed stream data');
                }
                if (json.error) {
                    throw new ProviderError(
                        'upstream_error',
                        `upstream error: ${sanitizeUpstreamText(redactor, json.error.message ?? 'unknown')}`,
                    );
                }
                usage = mapUsage(json.usage) ?? usage;
                const choice = json.choices?.[0];
                if (!choice) continue;
                const content = choice.delta?.content;
                if (typeof content === 'string' && content.length > 0) yield { type: 'text-delta', delta: content };
                for (const call of choice.delta?.tool_calls ?? []) {
                    const index = call.index ?? 0;
                    const entry = pending.get(index) ?? { id: '', name: '', args: '' };
                    if (call.id) entry.id = call.id;
                    if (call.function?.name) entry.name += call.function.name;
                    if (call.function?.arguments) entry.args += call.function.arguments;
                    pending.set(index, entry);
                }
                finish = mapFinish(choice.finish_reason) ?? finish;
            }
        } catch (error) {
            if (userSignal?.aborted) {
                yield { type: 'finish', reason: 'aborted' };
                return;
            }
            if (timedOut) throw new ProviderError('timeout', `no response within ${firstTokenTimeoutMs} ms`);
            if (error instanceof ProviderError) throw error;
            throw networkError(error);
        } finally {
            clearTimer();
            userSignal?.removeEventListener('abort', onAbort);
        }

        for (const [index, call] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
            let input: unknown = {};
            if (call.args.trim() !== '') {
                try {
                    input = JSON.parse(call.args);
                } catch {
                    throw new ProviderError(
                        'upstream_error',
                        `tool call ${call.name || index} has invalid JSON arguments`,
                    );
                }
            }
            yield {
                type: 'tool-call',
                callId: call.id || `call_${index}`,
                name: toolNames.get(call.name) ?? call.name,
                input,
            };
        }
        yield {
            type: 'finish',
            reason: finish ?? (pending.size > 0 ? 'tool-calls' : 'stop'),
            ...(usage ? { usage } : {}),
        };
    }

    async function test(signal?: AbortSignal): Promise<ModelTestResult> {
        if (profile.apiKeyRef !== null && options.getApiKey() === null) {
            return {
                ok: false,
                error: 'key_missing',
                message: `the key referenced by ${profile.apiKeyRef} is not set`,
            };
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.testTimeoutMs ?? 15_000);
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort, { once: true });
        const started = now();
        try {
            const res = await doFetch(`${base}/models`, { headers: headers(), signal: controller.signal });
            if (res.ok) {
                const json = (await res.json().catch(() => null)) as { data?: { id?: unknown }[] } | null;
                const models = (json?.data ?? [])
                    .map((m) => m.id)
                    .filter((id): id is string => typeof id === 'string')
                    .slice(0, 100);
                return { ok: true, latencyMs: now() - started, models };
            }
            // 部分兼容端点没有 /models:退回一次最小的对话请求
            if (res.status === 404 || res.status === 405) {
                await res.body?.cancel().catch(() => undefined);
                const chat = await doFetch(`${base}/chat/completions`, {
                    method: 'POST',
                    headers: headers(),
                    body: JSON.stringify({
                        model: profile.model,
                        messages: [{ role: 'user', content: 'ping' }],
                        max_tokens: 1,
                    }),
                    signal: controller.signal,
                });
                if (chat.ok) {
                    await chat.body?.cancel().catch(() => undefined);
                    return { ok: true, latencyMs: now() - started };
                }
                const err = await errorFrom(chat);
                return { ok: false, error: err.code, message: err.message };
            }
            const err = await errorFrom(res);
            return { ok: false, error: err.code, message: err.message };
        } catch (error) {
            if (controller.signal.aborted) return { ok: false, error: 'timeout', message: 'connection test timed out' };
            return { ok: false, error: 'network_error', message: networkError(error).message };
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
        }
    }

    return { profileId: profile.id, stream, test };
}
