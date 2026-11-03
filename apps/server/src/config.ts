// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import { OFFICIAL_SOURCE_URL } from '@ai-personal/shared';

/** 运行时配置,全部来自环境变量;默认只监听本机(见计划第 7 节)。 */
export interface ServerConfig {
    host: string;
    port: number;
    /** 当前部署的完整源码地址(AGPL §13);默认为官方仓库,修改版部署者应改为自己的源码地址。 */
    sourceUrl: string;
    /** 若设置,则由核心服务托管 Web UI 构建产物。 */
    webDir: string | null;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8787;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
    const port = env.AIP_PORT === undefined ? DEFAULT_PORT : Number(env.AIP_PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`AIP_PORT 非法: ${env.AIP_PORT}`);
    }
    return {
        host: env.AIP_HOST ?? DEFAULT_HOST,
        port,
        sourceUrl: env.AIP_SOURCE_URL || OFFICIAL_SOURCE_URL,
        webDir: env.AIP_WEB_DIR || null,
    };
}
