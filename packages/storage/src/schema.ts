// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// Drizzle 表定义,只用于类型化查询;真正的结构以 migrations/ 中的 SQL 为准,
// 两者一致性由 schema.test.ts 校验。约束(CHECK、外键、部分索引)只写在 SQL 中。
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const owners = sqliteTable('owners', {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const authSessions = sqliteTable('auth_sessions', {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    csrfHash: text('csrf_hash').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
});

export const accessTokens = sqliteTable('access_tokens', {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    expiresAt: text('expires_at'),
    revokedAt: text('revoked_at'),
});

export const modelProfiles = sqliteTable('model_profiles', {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['openai-compatible', 'anthropic', 'gemini'] }).notNull(),
    baseUrl: text('base_url'),
    apiKeyRef: text('api_key_ref'),
    model: text('model').notNull(),
    purposeJson: text('purpose_json').notNull(),
    contextWindow: integer('context_window'),
    paramsJson: text('params_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const settings = sqliteTable(
    'settings',
    {
        ownerId: text('owner_id').notNull(),
        key: text('key').notNull(),
        valueJson: text('value_json').notNull(),
        updatedAt: text('updated_at').notNull(),
    },
    (t) => [primaryKey({ columns: [t.ownerId, t.key] })],
);

export const sessions = sqliteTable('sessions', {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    title: text('title').notNull(),
    modelProfileId: text('model_profile_id'),
    forkedFromSessionId: text('forked_from_session_id'),
    forkedFromMessageId: text('forked_from_message_id'),
    lastMessageAt: text('last_message_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ownerId: text('owner_id').notNull(),
    seq: integer('seq').notNull(),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    partsJson: text('parts_json').notNull(),
    status: text('status', { enum: ['streaming', 'complete', 'error', 'cancelled'] }).notNull(),
    runId: text('run_id'),
    parentMessageId: text('parent_message_id'),
    modelProfileId: text('model_profile_id'),
    clientMessageId: text('client_message_id'),
    usageJson: text('usage_json'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const runs = sqliteTable('runs', {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    ownerId: text('owner_id').notNull(),
    status: text('status', {
        enum: ['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled'],
    }).notNull(),
    inputMessageId: text('input_message_id').notNull(),
    outputMessageId: text('output_message_id'),
    errorJson: text('error_json'),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
});

export const events = sqliteTable('events', {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    sessionId: text('session_id'),
    runId: text('run_id'),
    type: text('type').notNull(),
    payloadJson: text('payload_json').notNull(),
    createdAt: text('created_at').notNull(),
});

export const sessionSummaries = sqliteTable('session_summaries', {
    id: text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    fromSeq: integer('from_seq').notNull(),
    toSeq: integer('to_seq').notNull(),
    summary: text('summary').notNull(),
    createdAt: text('created_at').notNull(),
});

export const items = sqliteTable('items', {
    id: text('id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    kind: text('kind', { enum: ['category', 'content'] }).notNull(),
    type: text('type').notNull(),
    source: text('source').notNull(),
    sourceRef: text('source_ref'),
    title: text('title').notNull(),
    summary: text('summary'),
    icon: text('icon'),
    color: text('color'),
    childCount: integer('child_count').notNull(),
    descendantCount: integer('descendant_count').notNull(),
    meta: text('meta'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
});

export const itemEdges = sqliteTable(
    'item_edges',
    {
        parentId: text('parent_id').notNull(),
        childId: text('child_id').notNull(),
        rel: text('rel').notNull(),
        position: integer('position'),
        primaryEdge: integer('primary_edge').notNull(),
    },
    (t) => [primaryKey({ columns: [t.parentId, t.childId, t.rel] })],
);

export const memoryFacts = sqliteTable('memory_facts', {
    itemId: text('item_id').primaryKey(),
    ownerId: text('owner_id').notNull(),
    memType: text('mem_type', { enum: ['episodic', 'semantic', 'procedural'] }).notNull(),
    subtype: text('subtype', { enum: ['profile', 'preference', 'decision', 'task', 'relation'] }),
    entityKey: text('entity_key'),
    cardinality: text('cardinality', { enum: ['single', 'multi'] }).notNull(),
    valueJson: text('value_json'),
    status: text('status', { enum: ['active', 'superseded', 'conflicted', 'retracted', 'expired'] }).notNull(),
    domain: text('domain', { enum: ['work', 'life', 'general'] }).notNull(),
    sensitivity: integer('sensitivity').notNull(),
    confidence: real('confidence').notNull(),
    origin: text('origin', {
        enum: ['user_explicit', 'extracted', 'consolidated', 'manual', 'imported'],
    }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
});

export const memorySources = sqliteTable('memory_sources', {
    id: text('id').primaryKey(),
    memoryId: text('memory_id').notNull(),
    sessionId: text('session_id'),
    userMessageId: text('user_message_id'),
    answerMessageId: text('answer_message_id'),
    sourceItemId: text('source_item_id'),
    excerpt: text('excerpt'),
    createdAt: text('created_at').notNull(),
});
