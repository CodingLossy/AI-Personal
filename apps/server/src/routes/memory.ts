// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { createRoute, z } from '@hono/zod-openapi';
import type { RunManager } from '@ai-personal/agent';
import type { MemoryService } from '@ai-personal/memory';
import {
    ApprovalDecision,
    Id,
    Memory,
    MemoryPatch,
    MemorySaveInput,
    MemorySaveResult,
    MemorySearchInput,
    MemorySearchResult,
    pageOf,
} from '@ai-personal/shared';
import type { Repositories } from '@ai-personal/storage';
import { requireOwner } from '../auth/middleware.js';
import { ApiError, notFound } from '../errors.js';
import { authErrors, json, problem, router } from './common.js';

const idParam = z.object({ id: Id });

const listRoute = createRoute({
    method: 'get',
    path: '/memory',
    tags: ['memory'],
    summary: 'List active memories, most recently updated first',
    request: { query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }) },
    responses: { 200: json(pageOf(Memory), 'Memories'), ...authErrors },
});

const saveRoute = createRoute({
    method: 'post',
    path: '/memory',
    tags: ['memory'],
    summary: 'Save a memory written by the user; credentials are refused',
    request: { body: { content: { 'application/json': { schema: MemorySaveInput } }, required: true } },
    responses: {
        200: json(MemorySaveResult, 'created, merged, superseded or refused'),
        400: problem('Invalid request'),
        ...authErrors,
    },
});

const searchRoute = createRoute({
    method: 'post',
    path: '/memory/search',
    tags: ['memory'],
    summary: 'Search memories',
    request: { body: { content: { 'application/json': { schema: MemorySearchInput } }, required: true } },
    responses: { 200: json(MemorySearchResult, 'Matches, best first'), 400: problem('Invalid request'), ...authErrors },
});

const getRoute = createRoute({
    method: 'get',
    path: '/memory/{id}',
    tags: ['memory'],
    summary: 'Get a memory',
    request: { params: idParam },
    responses: { 200: json(Memory, 'Memory'), 404: problem('Not found'), ...authErrors },
});

const patchRoute = createRoute({
    method: 'patch',
    path: '/memory/{id}',
    tags: ['memory'],
    summary: 'Correct the text or domain of a memory, or retract it',
    request: { params: idParam, body: { content: { 'application/json': { schema: MemoryPatch } }, required: true } },
    responses: {
        200: json(Memory, 'Updated'),
        400: problem('Invalid request or the new text looks like a credential'),
        404: problem('Not found'),
        ...authErrors,
    },
});

const deleteRoute = createRoute({
    method: 'delete',
    path: '/memory/{id}',
    tags: ['memory'],
    summary: 'Forget a memory permanently, with its sources',
    request: { params: idParam },
    responses: { 204: { description: 'Deleted' }, 404: problem('Not found'), ...authErrors },
});

const approvalRoute = createRoute({
    method: 'post',
    path: '/approvals/{callId}',
    tags: ['runs'],
    summary: 'Approve or reject a pending tool call',
    request: {
        params: z.object({ callId: Id }),
        body: { content: { 'application/json': { schema: ApprovalDecision } }, required: true },
    },
    responses: {
        200: json(z.object({ callId: Id, decision: ApprovalDecision.shape.decision }), 'Decision recorded'),
        409: problem('No pending approval with this id'),
        ...authErrors,
    },
});

export interface MemoryRouteDeps {
    repos: Repositories;
    memory: MemoryService;
    runs: RunManager;
    detectCredential: (text: string) => string | null;
}

export function memoryRoutes(deps: MemoryRouteDeps) {
    const { repos, memory, runs } = deps;
    return router()
        .openapi(listRoute, (c) =>
            c.json({ items: repos.memories.list(requireOwner(c), c.req.valid('query').limit), nextCursor: null }, 200),
        )
        .openapi(saveRoute, (c) => c.json(memory.save(requireOwner(c), c.req.valid('json'), 'user_explicit'), 200))
        .openapi(searchRoute, (c) => c.json(memory.search(requireOwner(c), c.req.valid('json')), 200))
        .openapi(getRoute, (c) => {
            const m = repos.memories.get(requireOwner(c), c.req.valid('param').id);
            if (!m) throw notFound('Memory');
            return c.json(m, 200);
        })
        .openapi(patchRoute, (c) => {
            const body = c.req.valid('json');
            if (body.text !== undefined && deps.detectCredential(body.text)) {
                throw new ApiError(400, 'validation_failed', 'Bad Request', 'Credentials cannot be stored in memory.', {
                    issues: [{ path: ['text'], message: 'looks like a credential' }],
                });
            }
            const updated = repos.memories.update(requireOwner(c), c.req.valid('param').id, {
                ...(body.text !== undefined ? { text: body.text } : {}),
                ...(body.domain !== undefined ? { domain: body.domain } : {}),
                retract: body.status === 'retracted',
            });
            if (!updated) throw notFound('Memory');
            return c.json(updated, 200);
        })
        .openapi(deleteRoute, (c) => {
            const ownerId = requireOwner(c);
            const { id } = c.req.valid('param');
            if (!repos.memories.delete(ownerId, id)) throw notFound('Memory');
            c.get('logger').info({ memoryId: id }, 'memory forgotten');
            return c.body(null, 204);
        })
        .openapi(approvalRoute, (c) => {
            const { callId } = c.req.valid('param');
            const { decision } = c.req.valid('json');
            if (!runs.resolveApproval(requireOwner(c), callId, decision)) {
                throw new ApiError(
                    409,
                    'approval_not_pending',
                    'Conflict',
                    'There is no pending approval with this id.',
                );
            }
            return c.json({ callId, decision }, 200);
        });
}
