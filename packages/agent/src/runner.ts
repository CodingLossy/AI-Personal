// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { AgentEvent, Message, ProblemDetails, Usage } from '@ai-personal/shared';
import { type ChatMessage, type ModelProvider, ProviderError } from '@ai-personal/providers';
import type { ModelProfileRecord, Repositories } from '@ai-personal/storage';
import type { EventBus } from './bus.js';

export interface RunManagerOptions {
    repos: Repositories;
    bus: EventBus;
    /** 为配置档创建 provider;测试中可替换为假实现。 */
    providerFor: (profile: ModelProfileRecord) => ModelProvider;
    /** 流式过程中把已生成的正文写回消息表的最小间隔,默认 1 秒。 */
    persistIntervalMs?: number;
    now?: () => number;
    onError?: (error: unknown, context: { runId: string }) => void;
}

export interface StartRunInput {
    ownerId: string;
    sessionId: string;
    profile: ModelProfileRecord;
    /** 新的用户消息;与 inputMessageId 二选一。 */
    text?: string;
    clientMessageId?: string | undefined;
    /** 重试 / 重新生成:沿用已有的用户消息。 */
    inputMessageId?: string;
    /** 重新生成时被替代的助手消息。 */
    replacesMessageId?: string;
}

export interface StartedRun {
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
}

/** 同一会话同时只允许一个运行。 */
export class RunConflictError extends Error {
    override readonly name = 'RunConflictError';
    constructor(readonly activeRunId: string) {
        super('another run is active in this session');
    }
}

const TITLE_LENGTH = 40;

function textOf(message: Message): string {
    return message.parts
        .filter((p): p is Extract<Message['parts'][number], { type: 'text' }> => p.type === 'text')
        .map((p) => p.text)
        .join('');
}

/**
 * 运行管理:运行与 HTTP 连接解耦,客户端断开不会中断运行,只有 cancel 会(ADR 0004 第 5 节)。
 * 每个事件先写入事件表(获得全局 seq),再经事件总线推送。
 */
export class RunManager {
    private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();
    private readonly persistIntervalMs: number;
    private readonly now: () => number;

    constructor(private readonly options: RunManagerOptions) {
        this.persistIntervalMs = options.persistIntervalMs ?? 1000;
        this.now = options.now ?? Date.now;
    }

    private emit(ownerId: string, sessionId: string, runId: string, event: AgentEvent): void {
        const envelope = this.options.repos.events.append(ownerId, { sessionId, runId, event });
        this.options.bus.publish(ownerId, envelope, runId);
    }

    /** 在一个事务中创建用户消息、运行与空的助手消息,然后在后台执行。 */
    start(input: StartRunInput): StartedRun {
        const { repos } = this.options;
        const created = repos.transaction(() => {
            const running = repos.runs.activeInSession(input.ownerId, input.sessionId);
            if (running) throw new RunConflictError(running.id);

            let userMessageId = input.inputMessageId;
            if (!userMessageId) {
                const user = repos.messages.append(input.ownerId, input.sessionId, {
                    role: 'user',
                    parts: [{ type: 'text', text: input.text ?? '' }],
                    status: 'complete',
                    clientMessageId: input.clientMessageId,
                });
                userMessageId = user.id;
                const session = repos.sessions.get(input.ownerId, input.sessionId);
                if (session && session.title === '' && input.text) {
                    repos.sessions.update(input.ownerId, input.sessionId, {
                        title: input.text.replace(/\s+/g, ' ').trim().slice(0, TITLE_LENGTH),
                    });
                }
            }
            const run = repos.runs.create(input.ownerId, { sessionId: input.sessionId, inputMessageId: userMessageId });
            const assistant = repos.messages.append(input.ownerId, input.sessionId, {
                role: 'assistant',
                parts: [],
                status: 'streaming',
                runId: run.id,
                parentMessageId: input.replacesMessageId ?? null,
                modelProfileId: input.profile.id,
            });
            repos.runs.setStatus(run.id, 'running', { outputMessageId: assistant.id });
            return { runId: run.id, userMessageId, assistantMessageId: assistant.id, assistantSeq: assistant.seq };
        });

        const controller = new AbortController();
        const done = this.execute(input, created, controller.signal)
            .catch((error: unknown) => this.options.onError?.(error, { runId: created.runId }))
            .finally(() => this.active.delete(created.runId));
        this.active.set(created.runId, { controller, done });
        return {
            runId: created.runId,
            userMessageId: created.userMessageId,
            assistantMessageId: created.assistantMessageId,
        };
    }

    /** 中断运行;运行不存在或已结束时返回 false。 */
    cancel(runId: string): boolean {
        const entry = this.active.get(runId);
        if (!entry) return false;
        entry.controller.abort();
        return true;
    }

    /** 中断并等待运行完全结束(删除会话前调用,避免运行继续写已删除的行)。 */
    async stop(runId: string): Promise<void> {
        const entry = this.active.get(runId);
        if (!entry) return;
        entry.controller.abort();
        await entry.done;
    }

    isActive(runId: string): boolean {
        return this.active.has(runId);
    }

    /** 等待所有进行中的运行结束(测试与优雅退出用)。 */
    async idle(): Promise<void> {
        await Promise.all([...this.active.values()].map((e) => e.done));
    }

    /** 进程启动时:把上次异常退出遗留的运行标为失败,并补发终止事件,让客户端不会一直等待。 */
    recoverInterrupted(): number {
        const { repos } = this.options;
        const unfinished = repos.runs.listUnfinished();
        for (const run of unfinished) {
            const error = this.problem(run.id, 500, 'internal', 'The server restarted while this run was in progress.');
            repos.runs.setStatus(run.id, 'failed', { error });
            this.emit(run.ownerId, run.sessionId, run.id, { type: 'run-failed', runId: run.id, error });
        }
        repos.interruptStreamingMessages();
        return unfinished.length;
    }

    private problem(
        runId: string,
        status: number,
        code: ProblemDetails['code'],
        detail: string,
        providerCode?: ProblemDetails['providerCode'],
    ): ProblemDetails {
        return {
            type: 'about:blank',
            title: status >= 500 && code !== 'provider_error' ? 'Internal Server Error' : 'Model request failed',
            status,
            code,
            detail,
            requestId: runId,
            ...(providerCode ? { providerCode } : {}),
        };
    }

    /** 组装模型上下文:本会话中更早的用户消息与已完成的助手回复(跳过被重新生成替代的回复)。 */
    private context(ownerId: string, sessionId: string, beforeSeq: number): ChatMessage[] {
        const { repos } = this.options;
        const out: ChatMessage[] = [];
        for (const m of repos.messages.listBefore(ownerId, sessionId, beforeSeq)) {
            const text = textOf(m);
            if (m.role === 'user') out.push({ role: 'user', content: text });
            else if (m.role === 'system') out.push({ role: 'system', content: text });
            else if (m.status === 'complete' && text !== '' && !repos.messages.isSuperseded(m.id)) {
                out.push({ role: 'assistant', content: text });
            }
        }
        return out;
    }

    private async execute(
        input: StartRunInput,
        run: StartedRun & { assistantSeq: number },
        signal: AbortSignal,
    ): Promise<void> {
        const { repos } = this.options;
        const { ownerId, sessionId } = input;
        const emit = (event: AgentEvent) => this.emit(ownerId, sessionId, run.runId, event);

        emit({
            type: 'run-started',
            runId: run.runId,
            sessionId,
            userMessageId: run.userMessageId,
            assistantMessageId: run.assistantMessageId,
        });
        emit({ type: 'assistant-state', state: 'thinking' });

        let text = '';
        let lastPersist = this.now();
        const persist = (status: Message['status'], usage?: Usage | null) =>
            repos.messages.update(run.assistantMessageId, {
                parts: text === '' ? [] : [{ type: 'text', text }],
                status,
                ...(usage !== undefined ? { usage } : {}),
            });

        try {
            const provider = this.options.providerFor(input.profile);
            const messages = this.context(ownerId, sessionId, run.assistantSeq);
            let finished = false;
            for await (const chunk of provider.stream({ messages, signal })) {
                if (chunk.type === 'text-delta') {
                    text += chunk.delta;
                    emit({ type: 'text-delta', runId: run.runId, delta: chunk.delta });
                    if (this.now() - lastPersist >= this.persistIntervalMs) {
                        persist('streaming');
                        lastPersist = this.now();
                    }
                } else if (chunk.type === 'finish') {
                    finished = true;
                    if (chunk.reason === 'aborted') {
                        persist('cancelled', chunk.usage ?? null);
                        repos.runs.setStatus(run.runId, 'cancelled');
                        emit({ type: 'run-finished', runId: run.runId, reason: 'cancelled' });
                    } else {
                        persist('complete', chunk.usage ?? null);
                        repos.runs.setStatus(run.runId, 'succeeded');
                        emit({
                            type: 'run-finished',
                            runId: run.runId,
                            reason: chunk.reason === 'length' ? 'length' : 'stop',
                            ...(chunk.usage ? { usage: chunk.usage } : {}),
                        });
                    }
                }
                // M1 的这一步还没有工具:tool-call 块在 PR #6 接入审批与 memory 工具
            }
            if (!finished) {
                persist('complete', null);
                repos.runs.setStatus(run.runId, 'succeeded');
                emit({ type: 'run-finished', runId: run.runId, reason: 'stop' });
            }
        } catch (error) {
            const problem =
                error instanceof ProviderError
                    ? this.problem(run.runId, 502, 'provider_error', error.message, error.code)
                    : this.problem(run.runId, 500, 'internal', 'The run failed unexpectedly.');
            persist('error');
            repos.runs.setStatus(run.runId, 'failed', { error: problem });
            emit({ type: 'run-failed', runId: run.runId, error: problem });
            if (!(error instanceof ProviderError)) throw error;
        } finally {
            emit({ type: 'assistant-state', state: 'idle' });
        }
    }
}
