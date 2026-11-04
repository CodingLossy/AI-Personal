// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { ToolSpec } from '@ai-personal/providers';

export interface ToolContext {
    ownerId: string;
    sessionId: string;
    runId: string;
    userMessageId: string;
    assistantMessageId: string;
}

/**
 * 交给模型调用的工具。requiresApproval 为 true 时,运行在执行前暂停,
 * 发出 approval-required 事件,等用户经 POST /api/v1/approvals/{callId} 批准或拒绝(ADR 0007、M1 决定 2)。
 */
export interface AgentTool {
    name: string;
    description: string;
    /** JSON Schema。 */
    parameters: Record<string, unknown>;
    requiresApproval: boolean;
    /** 审批卡片上显示的一句话说明;输入来自模型,调用方展示时应视为不可信数据。 */
    summarize(input: unknown): string;
    /** 执行工具;输入未通过校验时应抛错,错误信息会作为工具结果返回给模型。 */
    execute(input: unknown, context: ToolContext): Promise<unknown>;
}

export function toolSpecs(tools: readonly AgentTool[]): ToolSpec[] {
    return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
