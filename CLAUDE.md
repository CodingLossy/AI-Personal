# CLAUDE.md

Claude Code 的项目说明。完整约定在 AGENTS.md 中(下面一行会把它导入上下文),两个文件不要各写一份,避免不一致。

@AGENTS.md

## 给 Claude Code 的补充

- 开始一个里程碑前,先读开发计划对应章节,并在 `docs/adr/` 写 / 更新设计记录;里程碑结束时逐条对照验收标准自检,停下等业主确认再进入下一个。
- 每一步先说明计划再动手;提交前运行 `pnpm lint && pnpm typecheck && pnpm test && pnpm check:spdx`。
- 新建源文件时直接带上 SPDX 头(见 AGENTS.md 第 5 条),不要事后补。
