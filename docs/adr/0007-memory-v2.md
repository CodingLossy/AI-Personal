# ADR 0007 · 记忆 v2:有类型、可更替、带出处的记忆(含净室声明)

- 状态:已采纳(业主 2026-11-03 正式采纳《记忆模块补充设计》)
- 日期:2026-11-03
- 来源:`docs/plan/AI-Personal-记忆模块补充设计.md`(下称「补充设计」);开发计划 6.2、第 7、12、13、15、16 节
- 编号说明:补充设计原拟 `0004-memory-v2.md`;0004–0006 已用于 M1 契约,本 ADR 顺延为 0007。

## 0. 净室声明(必须遵守)

补充设计参考了以下项目的**思想**:Danialsamadi/synapse(GPL-3.0)、UnKnownFish125/dsh-deepmemory(AGPL-3.0)、adoresever/graph-memory(许可证未核实)、liangmianya/dsh-synapse(许可证未核实)。为保证双许可成立(开发计划 13.4、15.2):

1. 只借鉴思想与架构,**不复制任何代码、SQL、提示词、测试数据、文案或配置**。即使许可证与本项目相同(AGPL),版权属于他人,同样不可复制。
2. 实现者只依据补充设计与本 ADR(用我们自己的话写的规格)编码;实现期间不打开、不搜索上述仓库的源码。PR 模板中勾选「未参考第三方源码,仅依据 docs/plan 规格」。
3. 不把上述项目加为依赖,不做 submodule 或 vendoring;许可证白名单 CI 照常生效。
4. 「未核实」的两个项目同样按「仅思想」处理;如需复用具体内容,先核实许可证并另写 ADR。
5. 可以在 NOTICE 或文档致谢中按名称致谢这些项目的思路;这不是许可要求,也不带来许可义务。

本条同时写入 AGENTS.md。

## 1. 决定

采纳补充设计第 1–8 节的目标、数据模型、写入 / 检索路径、生命周期任务、反馈闭环、知识地图与会话地图接入、REST 与工具接口,并按下面的复审意见调整。分阶段落地:

| 阶段             | 内容                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **M1(最小子集)** | 建 `items`、`item_edges`、`items_fts`(只建表与同步触发器,不做知识地图 API);建 `memory_facts` 子集与 `memory_sources`;会话 / 消息表一开始就带分叉列;工具 `memory.save` / `memory.search`(以后作为 `memory.write` / `memory.retrieve` 的别名保留),`memory.save` 默认需要审批;检索只用 FTS5(含 1–2 字查询的 LIKE 回退);最小凭据拒存规则 |
| **M2(记忆核心)** | 补齐 `memory_facts` 其余列、冲突 / 反馈 / 隔离区 / digest 表、向量表;完整写入路径(抽取、去重、更替、冲突)、三路召回 + RRF + 可信度说明 + 预算、digest、维护任务、反馈、REST 全集、`memory` ItemProvider、fork API、Web 记忆页                                                                                                        |
| **M10(可视化)**  | 粒子球中的记忆簇编码、会话地图 2D 画布                                                                                                                                                                                                                                                                                               |

### M1 的 `memory_facts` 子集

```sql
CREATE TABLE memory_facts (
  item_id     TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  owner_id    TEXT NOT NULL,
  mem_type    TEXT NOT NULL CHECK (mem_type IN ('episodic','semantic','procedural')),
  subtype     TEXT,
  entity_key  TEXT,
  cardinality TEXT NOT NULL DEFAULT 'multi' CHECK (cardinality IN ('single','multi')),
  value_json  TEXT,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','superseded','conflicted','retracted','expired')),
  domain      TEXT NOT NULL DEFAULT 'general' CHECK (domain IN ('work','life','general')),
  sensitivity INTEGER NOT NULL DEFAULT 0 CHECK (sensitivity BETWEEN 0 AND 2),
  confidence  REAL NOT NULL DEFAULT 0.7 CHECK (confidence BETWEEN 0 AND 1),
  origin      TEXT NOT NULL CHECK (origin IN ('user_explicit','extracted','consolidated','manual','imported')),
  created_at  TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_mem_single_active ON memory_facts(owner_id, entity_key)
  WHERE entity_key IS NOT NULL AND cardinality = 'single' AND status = 'active';
CREATE INDEX idx_mem_lookup ON memory_facts(owner_id, status, mem_type);
```

`memory_sources` 按补充设计 2.2 原样建立(它引用 `sessions`、`messages`、`items`,M1 都已存在)。M2 再用 `ALTER TABLE ADD COLUMN` 补齐 `supersedes_id`、`decision_state`、`tier`、`importance`、`decay_score`、`pinned`、`valid_from/to`、`last_*`、各计数、`vec_rowid`、`embed_model`;这些列要么没有外键,要么默认值为 NULL,符合 SQLite 对 `ADD COLUMN` 的限制,不需要重建表。

## 2. 复审意见(对补充设计的调整)

1. **向量表维度不能写死**:补充设计 2.2 中 `vec0(embedding float[1024])` 改为:不放进静态迁移,在用户配置 embed 档后由代码按该档维度创建;换维度时后台重建(ADR 0005 第 3 节)。
2. **级联删除与触发器**:`items` 硬删除 → 外键级联删除 `memory_facts` → `trg_memvec_cleanup` 清理向量。SQLite 中外键动作引发的删除会触发 DELETE 触发器,但必须有测试覆盖(补充设计 9 节属性测试 (d))。
3. **更替事务的顺序**:由于部分唯一索引 `ux_mem_single_active`,事务内必须**先**把旧记录改为 `superseded`,**再**插入新的 active 记录,否则会违反唯一约束。
4. **会话 / 消息的分叉列**:补充设计用 `ALTER TABLE` 给 `sessions`、`messages` 加外键列;改为 M1 建表时直接包含,M2 不再修改这两张表。
5. **FTS5 trigram 的限制**:少于 3 个字符的查询在 trigram 下无结果,按补充设计 4.1 用 `LIKE` 回退(只扫 active,最多 30 条);`items_fts` 使用外部内容表 + 触发器同步,M1 建立。
6. **zod 4 写法**:草图中的 `z.record(z.unknown())` 应为 `z.record(z.string(), z.unknown())`;`z.string().datetime()` 应为 `z.iso.datetime()`。M2 写 `packages/shared/src/memory.ts` 全量时按 zod 4 写法。
7. **工具命名与审批**:M1 的 `memory.save` / `memory.search` 保留为 `memory.write` / `memory.retrieve` 的别名。补充设计中 `memory.write` 默认预授权,与业主对 M1 的决定(`memory.save` 默认需要审批)不同;M1 按业主决定执行,M2 再定。
8. **契约变更**:`item_edges.rel` 增加 `supersedes`、`forked_from`,以及新的 AgentEvent `memory-used`,都属于 `packages/shared` 的契约变更,在 M2 对应 PR 中与本 ADR 一并实现;M1 的表中 `rel` 是普通 TEXT,不受影响。
9. **2GB 预算**:`memory.sleep`(整理)每次最多 10 次 LLM 调用、额外内存 < 60MB 的目标合理;是否放在 M2 还是推迟到 M6 由业主在 M2 方案中决定。

## 3. 后果

- M2 只需增量迁移,不需要重建 M1 的表。
- 记忆与知识地图共用 `items` / `item_edges` / `items_fts`,M1 就要承担这几张表的触发器与计数维护的最小实现。
- 净室要求成为长期约束,PR 模板与 AGENTS.md 中都有体现。
