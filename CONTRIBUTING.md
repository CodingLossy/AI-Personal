# 贡献指南 / Contributing

感谢你愿意为 AI-Personal 做贡献!English summary at the bottom.

## 1. 先签 CLA

AI-Personal 采用双许可(AGPL-3.0-only + 商业许可)。为了让作者能把你的贡献一并纳入商业许可,**所有外部贡献者都必须签署 [CLA](CLA.md)**。

- 个人:首次提交 PR 时,CLA Assistant 会在 PR 中提示,按提示回复即可。
- 代表公司贡献:请先让公司签署 CLA.md 第二部分(企业 CCLA),发送至 x19169738916@163.com。

未签 CLA 的 PR 无法合并。本项目**不使用** DCO 代替 CLA。

## 2. 开发环境

- Node.js 24 LTS(最低 22.12),pnpm 10(`corepack enable`)
- `pnpm install` 安装依赖,`pnpm dev` 同时启动核心服务(127.0.0.1:8787)与 Web UI(127.0.0.1:5173)

常用命令:

| 命令                                         | 作用                           |
| -------------------------------------------- | ------------------------------ |
| `pnpm dev`                                   | 开发模式启动 server + web      |
| `pnpm build`                                 | 构建全部包                     |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | 代码检查 / 类型检查 / 单元测试 |
| `pnpm format`                                | Prettier 格式化                |
| `pnpm check:spdx`                            | 检查源文件 SPDX 头             |
| `pnpm check:licenses`                        | 检查依赖许可证白名单           |
| `pnpm check:placeholders`                    | 检查模板占位符残留             |

## 3. 提交规范

- 使用 [Conventional Commits](https://www.conventionalcommits.org/):`feat(server): ...`、`fix(web): ...`、`docs: ...`、`chore: ...` 等;说明部分中英文均可。
- 小步提交:一个功能点一个分支 / PR。PR 描述写清动机、改动、测试方式;不确定的设计取舍列在「待决定问题」中。
- 分支命名:`feature-AI-Personal-<版本>` 或 `feature/<简述>`;紧急修复用 `hotfix-...`。
- 改动 `packages/shared` 的 schema / 事件协议前,先在 `docs/adr/` 写 ADR。
- 新工具必须附带单测与至少一条评测用例;涉及审批 / 权限的改动必须有越权用例。

## 4. 许可证头

每个新建源文件开头必须有 SPDX 头(年份为首次创建年份):

```ts
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 尹绪柏 (Theodore Yin)
```

`packages/plugin-sdk`、`packages/client`、`packages/shared` 使用 `Apache-2.0`。YAML / Shell / Dockerfile 用 `#`,CSS 用 `/* */`,HTML 用 `<!-- -->`。模板见 [templates/FILE-HEADER.txt](templates/FILE-HEADER.txt)。外部贡献者无需在文件头署名,版权由 CLA 覆盖并记录在 git 历史中。

## 5. 依赖许可证白名单

只允许宽松许可的依赖:MIT、BSD-2-Clause、BSD-3-Clause、ISC、Apache-2.0、0BSD、Unlicense、CC0-1.0、BlueOak-1.0.0、Python-2.0,以及**仅以未修改库形式使用**的 MPL-2.0。

**禁止**任何第三方 copyleft 依赖(GPL、LGPL、AGPL、SSPL、EUPL、CDDL 等),否则商业许可版无法合法发布。CI 中的 `pnpm check:licenses` 会强制检查。

同样禁止:遥测 / 崩溃上报 SDK(Sentry、PostHog、Segment 等)、需要额外常驻服务的依赖、来源或许可不明的代码片段。AI 生成的代码按项目许可提交,请在 PR 中注明。

## 6. 安全问题

请不要在公开 Issue 中报告漏洞,见 [SECURITY.md](SECURITY.md)。

---

## English Summary

1. **Sign the [CLA](CLA.md)** — required for every external contributor (CLA Assistant prompts you on your first PR; companies sign the CCLA in Part II). DCO alone is not accepted.
2. **Setup:** Node.js 24 LTS (≥ 22.12), pnpm 10; `pnpm install && pnpm dev`.
3. **Commits:** Conventional Commits, small focused PRs with motivation, changes and test plan. Write an ADR before changing `packages/shared` contracts.
4. **License headers:** every source file starts with `SPDX-License-Identifier: AGPL-3.0-only` and `Copyright (C) 2026 尹绪柏 (Theodore Yin)`; `plugin-sdk`, `client` and `shared` use `Apache-2.0`.
5. **Dependencies:** permissive licenses only (MIT, BSD, ISC, Apache-2.0, 0BSD, Unlicense, …; MPL-2.0 unmodified only). No third-party copyleft, no telemetry SDKs.
6. **Security issues:** see [SECURITY.md](SECURITY.md).

Copyright (C) 2026 尹绪柏 (Theodore Yin)
