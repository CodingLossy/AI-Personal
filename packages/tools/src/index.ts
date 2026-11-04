// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

// 工具框架(ADR 0010):工具定义、注册表、审批策略、审计摘要。内置工具在后续 PR 中加入本包。
export { DIGEST_LIMIT, inputDigest, redactedInput } from './digest.js';
export {
    checkRemember,
    decide,
    defaultApproval,
    isEnabled,
    isPreauthorizable,
    type PolicyDecision,
    type PolicyOptions,
} from './policy.js';
export { ToolRegistry, type ToolSpecLike } from './registry.js';
export type { ToolContext, ToolDefinition } from './types.js';
