// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 授权目录 REST 与文件工具的端到端用例(ADR 0011):越权路径被拒绝并审计;按目录预授权;撤销目录时删除预授权。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChatChunk, ChatRequest, ModelProvider } from '@ai-personal/providers';
import { AuditEntry, EventEnvelope, FsRoot, pageOf, Preauthorization, Session } from '@ai-personal/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, jsonBody, sessionFrom, TEST_PASSWORD, type TestServer } from './test-helpers.js';

let s: TestServer;
let base: string;
beforeEach(() => {
    base = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aip-fs-api-')));
    mkdirSync(path.join(base, 'Docs', 'notes'), { recursive: true });
    mkdirSync(path.join(base, 'Private'));
    writeFileSync(path.join(base, 'Docs', 'report.md'), '# 周报\n本周完成了 M2。');
    writeFileSync(path.join(base, 'Private', 'secret.txt'), 'top secret');
});
afterEach(async () => {
    await s?.cleanup();
    rmSync(base, { recursive: true, force: true });
});

type Step = (request: ChatRequest) => AsyncGenerator<ChatChunk>;
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

async function setup() {
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
    s = await createTestServer({}, { provider });
    const res = await s.app.request('/api/v1/auth/setup', jsonBody({ username: 'owner', password: TEST_PASSWORD }));
    const { cookie, csrf } = sessionFrom(res);
    const headers = { cookie, 'X-CSRF-Token': csrf, 'content-type': 'application/json' };
    const req = (p: string, init: RequestInit = {}) => s.app.request(p, { ...init, headers });
    const post = (p: string, body: unknown = {}) => req(p, { method: 'POST', body: JSON.stringify(body) });
    await post('/api/v1/models', {
        label: 'fake',
        kind: 'openai-compatible',
        baseURL: 'http://fake.test/v1',
        apiKeyRef: null,
        model: 'm',
        purpose: ['chat'],
    });
    const session = Session.parse(await (await post('/api/v1/sessions')).json());
    const run = async (text: string, onEvent: (e: EventEnvelope) => Promise<void> | void = () => undefined) => {
        const out = await post(`/api/v1/sessions/${session.id}/messages`, { text });
        const reader = out.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const events: EventEnvelope[] = [];
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let idx: number;
            while ((idx = buffer.indexOf('\n\n')) >= 0) {
                const data = /^data: (.*)$/m.exec(buffer.slice(0, idx))?.[1];
                buffer = buffer.slice(idx + 2);
                if (!data) continue;
                const e = EventEnvelope.parse(JSON.parse(data));
                events.push(e);
                await onEvent(e);
            }
        }
        return events;
    };
    return { steps, requests, req, post, run };
}

describe('/api/v1/fs/roots 与文件工具', () => {
    it('授权目录:保存 realpath;拒绝重复、不存在、相对路径与整个盘;未登录 401', async () => {
        const { req, post } = await setup();
        const created = await post('/api/v1/fs/roots', { path: path.join(base, 'Docs', 'notes', '..'), label: '文档' });
        expect(created.status).toBe(201);
        expect(FsRoot.parse(await created.json())).toMatchObject({ path: path.join(base, 'Docs'), label: '文档' });
        expect((await post('/api/v1/fs/roots', { path: path.join(base, 'Docs') })).status).toBe(409);
        expect((await post('/api/v1/fs/roots', { path: path.join(base, 'nope') })).status).toBe(400);
        expect((await post('/api/v1/fs/roots', { path: 'relative' })).status).toBe(400);
        expect((await post('/api/v1/fs/roots', { path: path.parse(base).root })).status).toBe(400);
        expect((await s.app.request('/api/v1/fs/roots')).status).toBe(401);
        const list = pageOf(FsRoot).parse(await (await req('/api/v1/fs/roots')).json()).items;
        expect(list).toHaveLength(1);
    });

    it('越权路径被拒绝并有审计;按目录预授权写入;撤销目录时删除相关预授权', async () => {
        const { steps, requests, req, post, run } = await setup();
        const root = FsRoot.parse(await (await post('/api/v1/fs/roots', { path: path.join(base, 'Docs') })).json());

        // 1) 读取授权目录之外的文件:工具拒绝,审计记为 denied
        steps.push(callTool('fs.read', { path: path.join(base, 'Private', 'secret.txt') }), answer('不能读。'));
        await run('读一下那个秘密文件');
        const toolMessage = requests[1]!.messages.at(-1)!;
        expect(toolMessage.content).toMatch(/outside the authorized folders/);
        expect(toolMessage.content).not.toContain('top secret');
        let audit = pageOf(AuditEntry).parse(await (await req('/api/v1/audit')).json()).items;
        expect(audit[0]).toMatchObject({ toolName: 'fs.read', risk: 'read', decision: 'denied', outcome: 'not_run' });

        // 2) 写入:需要审批;批准并记住 notes 目录(传入未规范化的路径,服务器 realpath 后保存)
        const target = path.join(base, 'Docs', 'notes', 'summary.md');
        steps.push(callTool('fs.write', { path: target, content: '# 摘要' }), answer('已写入。'));
        await run('写一份摘要', async (e) => {
            if (e.event.type !== 'approval-required') return;
            expect(e.event).toMatchObject({ toolName: 'fs.write', risk: 'write' });
            const blanket = await post(`/api/v1/approvals/${e.event.callId}`, {
                decision: 'approve',
                remember: { scope: 'always' },
            });
            expect(blanket.status).toBe(400);
            const outside = await post(`/api/v1/approvals/${e.event.callId}`, {
                decision: 'approve',
                remember: { scope: 'always', constraint: { pathPrefix: path.join(base, 'Private') } },
            });
            expect(outside.status).toBe(400);
            const ok = await post(`/api/v1/approvals/${e.event.callId}`, {
                decision: 'approve',
                remember: { scope: 'always', constraint: { pathPrefix: path.join(base, 'Docs', 'notes', '.', '') } },
            });
            expect(ok.status).toBe(200);
        });
        expect(readFileSync(target, 'utf8')).toBe('# 摘要');
        const preauths = pageOf(Preauthorization).parse(await (await req('/api/v1/preauthorizations')).json()).items;
        expect(preauths).toEqual([
            expect.objectContaining({
                toolName: 'fs.write',
                constraint: { pathPrefix: path.join(base, 'Docs', 'notes') },
            }),
        ]);

        // 3) 同一目录再次写入:预授权生效;目录外仍需审批
        steps.push(
            callTool('fs.write', { path: path.join(base, 'Docs', 'notes', 'b.md'), content: 'b' }),
            answer('ok'),
        );
        const second = await run('再写一份');
        expect(second.map((e) => e.event.type)).not.toContain('approval-required');
        expect(existsSync(path.join(base, 'Docs', 'notes', 'b.md'))).toBe(true);

        // 4) 撤销授权目录:相关预授权一并删除并审计;之后读写都被拒绝
        expect((await req(`/api/v1/fs/roots/${root.id}`, { method: 'DELETE' })).status).toBe(204);
        expect(pageOf(Preauthorization).parse(await (await req('/api/v1/preauthorizations')).json()).items).toEqual([]);
        audit = pageOf(AuditEntry).parse(await (await req('/api/v1/audit')).json()).items;
        expect(audit[0]).toMatchObject({ action: 'preauth-revoked', toolName: 'fs.write' });
        steps.push(callTool('fs.read', { path: path.join(base, 'Docs', 'report.md') }), answer('不能读。'));
        await run('读周报');
        expect(requests.at(-1)!.messages.at(-1)!.content).toMatch(/no folder has been authorized/);
        expect((await req(`/api/v1/fs/roots/${root.id}`, { method: 'DELETE' })).status).toBe(404);
    });
});
