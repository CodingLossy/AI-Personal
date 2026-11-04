// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { fileURLToPath } from 'node:url';
import { createReplayFetch, loadFixture } from '@ai-personal/eval';
import type { ChatChunk, ChatRequest, ModelProvider } from '@ai-personal/providers';
import {
    EventEnvelope,
    Memory,
    MemorySaveResult,
    MemorySearchResult,
    ProblemDetails,
    Session,
} from '@ai-personal/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestServer, jsonBody, sessionFrom, TEST_PASSWORD, type TestServer } from './test-helpers.js';

const FIXTURES = fileURLToPath(new URL('../../../packages/providers/test/fixtures/', import.meta.url));

let s: TestServer;
afterEach(async () => {
    await s?.cleanup();
});

type Step = (request: ChatRequest) => AsyncGenerator<ChatChunk>;

function scripted() {
    const steps: Step[] = [];
    const requests: ChatRequest[] = [];
    const provider: ModelProvider = {
        profileId: 'fake',
        stream: (request) => {
            requests.push(request);
            const next = steps.shift();
            if (!next) throw new Error('no scripted step');
            return next(request);
        },
        test: () => Promise.resolve({ ok: true, latencyMs: 0 }),
    };
    return { provider, steps, requests };
}

const callTool = (name: string, input: unknown): Step =>
    async function* () {
        yield { type: 'tool-call', callId: 'c1', name, input };
        yield { type: 'finish', reason: 'tool-calls' };
    };
const answer = (text: string): Step =>
    async function* () {
        yield { type: 'text-delta', delta: text };
        yield { type: 'finish', reason: 'stop' };
    };

async function setup(options: Parameters<typeof createTestServer>[1] = {}) {
    const fake = scripted();
    s = await createTestServer({}, { provider: fake.provider, ...options });
    const res = await s.app.request('/api/v1/auth/setup', jsonBody({ username: 'owner', password: TEST_PASSWORD }));
    const { cookie, csrf } = sessionFrom(res);
    const headers = { cookie, 'X-CSRF-Token': csrf, 'content-type': 'application/json' };
    const req = (path: string, init: RequestInit = {}) => s.app.request(path, { ...init, headers });
    const post = (path: string, body: unknown = {}) => req(path, { method: 'POST', body: JSON.stringify(body) });
    await post('/api/v1/models', {
        label: 'fake',
        kind: 'openai-compatible',
        baseURL: 'http://fake.test/v1',
        apiKeyRef: null,
        model: 'm',
        purpose: ['chat'],
    });
    const newSession = async () => Session.parse(await (await post('/api/v1/sessions')).json());
    return { fake, req, post, newSession };
}

/** 读 SSE 流,每收到一个事件回调一次;回调可以发起其他请求(例如审批)。 */
async function readSse(res: Response, onEvent: (e: EventEnvelope) => Promise<void> | void): Promise<EventEnvelope[]> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const out: EventEnvelope[] = [];
    let buffer = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!data) continue;
            const envelope = EventEnvelope.parse(JSON.parse(data));
            out.push(envelope);
            await onEvent(envelope);
        }
    }
    return out;
}

describe('/api/v1/memory', () => {
    it('写入、读取、编辑、撤回、删除;凭据拒存', async () => {
        const { req, post } = await setup();
        const saved = MemorySaveResult.parse(await (await post('/api/v1/memory', { text: '用户常住杭州' })).json());
        expect(saved.outcome).toBe('created');
        const id = saved.id!;

        const refused = MemorySaveResult.parse(
            await (await post('/api/v1/memory', { text: '我的 key 是 sk-proj-abcdefghijklmnop1234' })).json(),
        );
        expect(refused).toEqual({ outcome: 'refused', reason: 'credential' });

        const list = (await (await req('/api/v1/memory')).json()) as { items: Memory[] };
        expect(list.items.map((m) => m.text)).toEqual(['用户常住杭州']);

        const patched = await req(`/api/v1/memory/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ text: '用户常住杭州西湖区', domain: 'life' }),
        });
        expect(Memory.parse(await patched.json())).toMatchObject({ text: '用户常住杭州西湖区', domain: 'life' });
        const bad = await req(`/api/v1/memory/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ text: '密码是 hunter2hunter2' }),
        });
        expect(bad.status).toBe(400);
        expect(ProblemDetails.parse(await bad.json()).code).toBe('validation_failed');

        const found = MemorySearchResult.parse(await (await post('/api/v1/memory/search', { query: '西湖' })).json());
        expect(found.items).toHaveLength(1);

        await req(`/api/v1/memory/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'retracted' }) });
        expect(
            MemorySearchResult.parse(await (await post('/api/v1/memory/search', { query: '西湖' })).json()).items,
        ).toHaveLength(0);

        expect((await req(`/api/v1/memory/${id}`, { method: 'DELETE' })).status).toBe(204);
        expect((await req(`/api/v1/memory/${id}`)).status).toBe(404);
    });
});

describe('memory.save 审批流程(验收:记住我住杭州 → 新会话问我住哪)', () => {
    it('批准后写入记忆;新会话中 memory.search 能找到', async () => {
        const { fake, post, newSession } = await setup();
        const first = await newSession();
        fake.steps.push(callTool('memory.save', { text: '用户常住杭州', entityKey: 'user.location.city' }));
        fake.steps.push(answer('好的,我记住了。'));

        const res = await post(`/api/v1/sessions/${first.id}/messages`, { text: '记住我住杭州' });
        const events = await readSse(res, async (e) => {
            if (e.event.type === 'approval-required') {
                expect(e.event.summary).toBe('Remember: 用户常住杭州');
                const ok = await post(`/api/v1/approvals/${e.event.callId}`, { decision: 'approve' });
                expect(ok.status).toBe(200);
            }
        });
        expect(events.map((e) => e.event.type)).toContain('approval-resolved');
        expect(events.at(-1)!.event.type).toBe('run-finished');
        const result = events.find((e) => e.event.type === 'tool-result')!.event as { output: { outcome: string } };
        expect(result.output.outcome).toBe('created');

        // 新会话:模型调用 memory.search,拿到之前记住的内容
        const second = await newSession();
        fake.steps.push(callTool('memory.search', { query: '杭州' }));
        fake.steps.push(answer('你住在杭州。'));
        const res2 = await post(`/api/v1/sessions/${second.id}/messages`, { text: '我住哪?' });
        const events2 = await readSse(res2, () => undefined);
        const search = events2.find((e) => e.event.type === 'tool-result')!.event as {
            output: { items: { text: string }[] };
        };
        expect(search.output.items.map((i) => i.text)).toEqual(['用户常住杭州']);
        expect(events2.map((e) => e.event.type)).not.toContain('approval-required');
        // 工具结果作为 tool 消息交回模型
        expect(fake.requests.at(-1)!.messages.at(-1)).toMatchObject({ role: 'tool' });
    });

    it('拒绝后不写入;重复审批或未知 callId 返回 409;拒绝时不能带 remember', async () => {
        const { fake, post, req, newSession } = await setup();
        const session = await newSession();
        fake.steps.push(callTool('memory.save', { text: '用户喜欢喝龙井' }));
        fake.steps.push(answer('好的,不记了。'));
        let callId = '';
        await readSse(await post(`/api/v1/sessions/${session.id}/messages`, { text: '记住我喜欢龙井' }), async (e) => {
            if (e.event.type === 'approval-required') {
                callId = e.event.callId;
                // remember 只能在批准时使用:带 remember 的拒绝返回 400,审批仍然待处理
                const remembered = await post(`/api/v1/approvals/${callId}`, {
                    decision: 'reject',
                    remember: { scope: 'always' },
                });
                expect(remembered.status).toBe(400);
                await post(`/api/v1/approvals/${callId}`, { decision: 'reject' });
            }
        });
        expect(((await (await req('/api/v1/memory')).json()) as { items: unknown[] }).items).toEqual([]);
        const again = await post(`/api/v1/approvals/${callId}`, { decision: 'approve' });
        expect(again.status).toBe(409);
        expect(ProblemDetails.parse(await again.json()).code).toBe('approval_not_pending');
    });
});

describe('评测:真实 OpenAI 兼容 provider 回放 memory.save 往返', () => {
    it('工具名映射、审批、工具结果交回模型', async () => {
        const replay = createReplayFetch(loadFixture(`${FIXTURES}memory-save-roundtrip.json`));
        // provider 置空:走 createProvider + 回放 fetch,而不是脚本化 provider
        const { post, req, newSession } = await setup({ fetch: replay.fetch, provider: undefined });
        const session = await newSession();
        const events = await readSse(
            await post(`/api/v1/sessions/${session.id}/messages`, { text: '记住我住杭州' }),
            async (e) => {
                if (e.event.type === 'approval-required') {
                    expect(e.event.summary).toBe('Remember: 用户常住杭州');
                    await post(`/api/v1/approvals/${e.event.callId}`, { decision: 'approve' });
                }
            },
        );
        expect(events.at(-1)!.event.type).toBe('run-finished');
        expect(replay.remaining()).toBe(0);

        const first = replay.calls[0]!.body as { tools: { function: { name: string } }[] };
        expect(first.tools.map((t) => t.function.name)).toEqual([
            'memory__save',
            'memory__search',
            'time',
            'calc',
            'web__fetch',
            'fs__list',
            'fs__read',
            'fs__search',
            'fs__write',
            'fs__move',
        ]);
        const second = replay.calls[1]!.body as { messages: { role: string; content?: string }[] };
        const toolMessage = second.messages.find((m) => m.role === 'tool');
        expect(toolMessage?.content).toContain('created');

        const list = (await (await req('/api/v1/memory')).json()) as { items: unknown[] };
        expect(list.items.map((m) => Memory.parse(m).text)).toEqual(['用户常住杭州']);
    });
});

describe('越权', () => {
    it('未登录不能读写记忆或审批;缺少 CSRF 令牌的修改请求被拒绝', async () => {
        const { req } = await setup();
        const anon = (path: string, init: RequestInit = {}) => s.app.request(path, init);
        expect((await anon('/api/v1/memory')).status).toBe(401);
        expect((await anon('/api/v1/memory', jsonBody({ text: '用户常住杭州' }))).status).toBe(401);
        expect((await anon('/api/v1/memory/search', jsonBody({ query: '杭州' }))).status).toBe(401);
        expect((await anon('/api/v1/approvals/c1', jsonBody({ decision: 'approve' }))).status).toBe(401);

        // 带会话 Cookie 但不带 X-CSRF-Token
        const login = await s.app.request(
            '/api/v1/auth/login',
            jsonBody({ username: 'owner', password: TEST_PASSWORD }),
        );
        const { cookie } = sessionFrom(login);
        const noCsrf = await s.app.request('/api/v1/approvals/c1', {
            method: 'POST',
            headers: { cookie, 'content-type': 'application/json' },
            body: JSON.stringify({ decision: 'approve' }),
        });
        expect(noCsrf.status).toBe(403);
        expect(ProblemDetails.parse(await noCsrf.json()).code).toBe('csrf_failed');
        expect(((await (await req('/api/v1/memory')).json()) as { items: unknown[] }).items).toEqual([]);
    });
});
