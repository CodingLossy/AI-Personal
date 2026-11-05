// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { createRoute, z } from '@hono/zod-openapi';
import type { MemoryStack } from '../memory-setup.js';
import {
    Id,
    Memory,
    MemoryDigest,
    MemoryPatch,
    MemoryRetrieveInput,
    MemoryRetrieveResult,
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

const retrieveRoute = createRoute({
    method: 'post',
    path: '/memory/retrieve',
    tags: ['memory'],
    summary: 'Retrieve memories with full-text, vector and graph recall, with trust qualifiers and a rendered block',
    request: { body: { content: { 'application/json': { schema: MemoryRetrieveInput } }, required: true } },
    responses: {
        200: json(MemoryRetrieveResult, 'Ranked memories and the rendered memory block'),
        400: problem('Invalid request'),
        ...authErrors,
    },
});

const digestRoute = createRoute({
    method: 'get',
    path: '/memory/digest',
    tags: ['memory'],
    summary: 'The memory digest injected at the start of each session',
    responses: { 200: json(MemoryDigest, 'Digest'), ...authErrors },
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

export interface MemoryRouteDeps {
    repos: Repositories;
    memory: MemoryStack;
    detectCredential: (text: string) => string | null;
}

export function memoryRoutes(deps: MemoryRouteDeps) {
    const { repos } = deps;
    const { memory } = deps.memory;
    return router()
        .openapi(listRoute, (c) =>
            c.json({ items: repos.memories.list(requireOwner(c), c.req.valid('query').limit), nextCursor: null }, 200),
        )
        .openapi(saveRoute, (c) => c.json(memory.save(requireOwner(c), c.req.valid('json'), 'user_explicit'), 200))
        .openapi(searchRoute, (c) => c.json(memory.search(requireOwner(c), c.req.valid('json')), 200))
        .openapi(retrieveRoute, async (c) =>
            c.json(await deps.memory.retriever.retrieve(requireOwner(c), c.req.valid('json')), 200),
        )
        .openapi(digestRoute, (c) => c.json(deps.memory.digest.get(requireOwner(c)), 200))
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
            deps.memory.changed(
                requireOwner(c),
                body.text !== undefined ? { id: updated.id, text: updated.text } : undefined,
            );
            return c.json(updated, 200);
        })
        .openapi(deleteRoute, (c) => {
            const ownerId = requireOwner(c);
            const { id } = c.req.valid('param');
            if (!repos.memories.delete(ownerId, id)) throw notFound('Memory');
            c.get('logger').info({ memoryId: id }, 'memory forgotten');
            deps.memory.changed(ownerId);
            return c.body(null, 204);
        });
}
