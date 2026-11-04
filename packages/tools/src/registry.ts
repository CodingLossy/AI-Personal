// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { PreauthConstraintKind, ToolInfo } from '@ai-personal/shared';
import { defaultApproval, isEnabled, isPreauthorizable, type PolicyOptions } from './policy.js';
import type { ToolDefinition } from './types.js';

/** 交给模型的工具声明(与 providers 的 ToolSpec 结构相同)。 */
export interface ToolSpecLike {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

/** 内置工具名:小写的点分段;MCP 工具另有 mcp. 前缀。 */
const NAME = /^[a-z][a-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

/** 工具注册表(ADR 0010):按名称查找,列出给模型与 UI 的工具。 */
export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();

    constructor(readonly options: PolicyOptions = {}) {}

    register(...tools: ToolDefinition[]): this {
        for (const tool of tools) {
            if (!NAME.test(tool.name) || tool.name.length > 200) throw new Error(`invalid tool name: ${tool.name}`);
            if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
            this.tools.set(tool.name, tool);
        }
        return this;
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    get size(): number {
        return this.tools.size;
    }

    /** 交给模型的工具:被禁用的工具不提供。 */
    specs(): ToolSpecLike[] {
        return [...this.tools.values()]
            .filter((t) => isEnabled(t, this.options))
            .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
    }

    /** GET /api/v1/tools。 */
    info(): ToolInfo[] {
        return [...this.tools.values()]
            .map((t) => ({
                name: t.name,
                description: t.description,
                risk: t.risk,
                approval: defaultApproval(t, this.options),
                source: t.source ?? 'builtin',
                server: t.server ?? null,
                preauthorizable: isPreauthorizable(t) && isEnabled(t, this.options),
                constraints: Object.keys(t.constraints ?? {}) as PreauthConstraintKind[],
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }
}
