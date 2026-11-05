// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 性能测量(M2 方案 PR 12 验收):1 万条记忆时 retrieve(不含嵌入往返)P95 < 80 ms,digest 读取 < 5 ms。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { type Connection, createRepositories, openStorage } from '@ai-personal/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDigestBuilder } from './digest.js';
import { createRetriever } from './retrieve.js';

const N = 10_000;
const PLACES = ['杭州', '上海', '北京', '深圳', '成都', '西安', '南京', '武汉', '苏州', '厦门'];
const TOPICS = ['跑步', '游泳', '咖啡', '龙井', '摄影', '围棋', '吉他', '烘焙', '登山', '骑行', 'Rust', 'TypeScript'];
const PEOPLE = ['张三', '李四', '王五', '赵六', '孙七'];

const p95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.floor(samples.length * 0.95)]!;

describe(`性能:${N} 条记忆`, () => {
    let dir: string;
    let conn: Connection;
    let ownerId: string;

    beforeAll(async () => {
        dir = mkdtempSync(join(tmpdir(), 'aip-memory-perf-'));
        ({ conn } = await openStorage({ dataDir: dir }));
        const repos = createRepositories(conn);
        ownerId = repos.owners.create({ username: 'owner', passwordHash: 'x' }).id;
        conn.sqlite.transaction(() => {
            for (let i = 0; i < N; i++) {
                const text =
                    `${PEOPLE[i % 5]}在${PLACES[i % 10]}和用户一起${TOPICS[i % 12]},第 ${i} 次记录` +
                    (i % 7 === 0 ? ',用户很喜欢' : '');
                repos.memories.save(ownerId, {
                    text,
                    memType: i % 3 === 0 ? 'episodic' : 'semantic',
                    subtype: null,
                    entityKey: null,
                    cardinality: 'multi',
                    value: null,
                    domain: i % 2 === 0 ? 'life' : 'work',
                    sensitivity: 0,
                    confidence: 0.6 + (i % 4) / 10,
                    origin: i % 2 === 0 ? 'user_explicit' : 'extracted',
                });
            }
        })();
    }, 300_000);
    afterAll(() => {
        conn.close();
        rmSync(dir, { recursive: true, force: true });
    });

    it('retrieve P95 < 80 ms,digest 读取 < 5 ms', async () => {
        const repos = createRepositories(conn);
        const retriever = createRetriever({ repos, flushMs: 60_000 });
        const queries = [
            '我在杭州的时候做过什么',
            '张三 游泳',
            '龙井',
            'TypeScript',
            '用户喜欢在成都骑行吗',
            '第 4321 次记录',
            '王五和用户一起摄影',
            '咖啡',
        ];
        for (const q of queries) await retriever.retrieve(ownerId, { query: q }); // 预热语句缓存
        const samples: number[] = [];
        for (let round = 0; round < 25; round++) {
            for (const query of queries) {
                const start = performance.now();
                const result = await retriever.retrieve(ownerId, { query });
                samples.push(performance.now() - start);
                expect(result.items.length).toBeGreaterThan(0);
            }
        }
        retriever.flush();

        const digest = createDigestBuilder({ repos });
        const buildStart = performance.now();
        digest.build(ownerId);
        const buildMs = performance.now() - buildStart;
        const reads: number[] = [];
        for (let i = 0; i < 200; i++) {
            const start = performance.now();
            digest.get(ownerId);
            reads.push(performance.now() - start);
        }

        const retrieveP95 = p95(samples);
        const digestP95 = p95(reads);
        console.log(
            `[perf] ${N} memories: retrieve p95 ${retrieveP95.toFixed(1)} ms (${samples.length} runs), ` +
                `digest read p95 ${digestP95.toFixed(2)} ms, digest build ${buildMs.toFixed(1)} ms`,
        );
        expect(retrieveP95).toBeLessThan(80);
        expect(digestP95).toBeLessThan(5);
    }, 120_000);
});
