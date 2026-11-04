// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)

import type { Migration } from '../migrate.js';
import { migration0001 } from './0001_init.js';
import { migration0002 } from './0002_tools.js';
import { migration0003 } from './0003_fs_roots.js';
import { migration0004 } from './0004_mcp_servers.js';

/** 按 id 顺序排列的全部迁移;新增迁移追加在末尾,已发布的迁移不得修改。 */
export const migrations: readonly Migration[] = [migration0001, migration0002, migration0003, migration0004];
