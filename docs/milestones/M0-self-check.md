# M0 自检报告

- 日期:2026-11-03
- 分支:`feature-AI-Personal-V0.1.0`(本地仓库,尚未推送;共 12 个提交)
- 环境:Windows 11,Node 24.15.0,pnpm 10.11.1;**本机未安装 Docker**

## 一、M0 验收标准(计划第 8 节)

| #   | 验收项                                     | 结果                        | 依据                                                                                                                                                                               |
| --- | ------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm i && pnpm dev` 同时起 server 和 web  | ✅ 通过                     | 本地实测:`/healthz` 200,`:5173` 200,经 Vite 代理访问 `/api/v1/meta` 正常                                                                                                           |
| 2   | `docker compose up` 后 `/healthz` 返回 200 | ⚠️ 未在本机验证             | 本机无 Docker。已在本地模拟镜像的 deploy 阶段(`pnpm deploy --prod --legacy`),产物 11MB,能启动并托管 Web UI;CI 的 `docker` 任务会构建镜像并检查 `/healthz`                          |
| 3   | CI 全绿                                    | ⚠️ 本地全绿,GitHub 上未运行 | 仓库尚未推送。本地已逐项跑通:format:check、lint、typecheck、test(11 个用例)、build、check:spdx、check:placeholders、check:licenses、`reuse lint`、`pnpm install --frozen-lockfile` |
| 4   | 镜像空闲 RSS < 120MB                       | ⚠️ 未在本机验证             | 本地以生产方式运行 deploy 产物,Windows 工作集约 67MB(仅供参考);CI 的 `docker` 任务读取容器内 `VmRSS` 并断言 < 120MB                                                                |

M0 范围内的其他内容:

| 项目                                                                                                                                        | 结果                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| pnpm + Turborepo 单仓;TS strict、ESLint flat、Prettier、Vitest                                                                              | ✅ TS 6.0.3、ESLint 10、Prettier 3.9、Vitest 5.1                                    |
| 第 5 节目录:apps/{server,web,cli,docs,desktop},packages/{shared,agent,providers,tools,memory,items,channels,plugin-sdk,client,ui,i18n,eval} | ✅ cli / docs / desktop 只放了说明文件;其余包为可构建的空包                         |
| `apps/server`(Hono,`/healthz`)                                                                                                              | ✅ 另加了 `/api/v1/meta`(含 `license`、`sourceUrl`)和 `X-AIP-Server-Version` 响应头 |
| `apps/web`(Vite + React 空壳)                                                                                                               | ✅ 页脚显示许可证与源码链接                                                         |
| `packages/shared`                                                                                                                           | ✅ Apache-2.0,含 meta / health 的 zod schema                                        |
| CLAUDE.md / AGENTS.md                                                                                                                       | ✅ 内容在 AGENTS.md,CLAUDE.md 通过 `@AGENTS.md` 导入                                |
| Issue / PR 模板                                                                                                                             | ✅                                                                                  |
| Dockerfile(多阶段、node slim、非 root)与 docker-compose                                                                                     | ✅(待 CI 验证)                                                                      |
| ADR 0001 / 0002 / 0003                                                                                                                      | ✅                                                                                  |
| Changesets 或 release-please                                                                                                                | ❌ 未做,见第三节                                                                    |

## 二、许可证落地清单(计划 15.9)

| 清单项                                                                        | 结果        | 说明                                                                                                                              |
| ----------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `LICENSE` 为 AGPL-3.0 官方全文,原样未改                                       | ✅          | 与 templates/LICENSE 逐字节一致,SHA-256 `0d96a4ff…abcb0` 与 gnu.org 官方文本相同                                                  |
| `NOTICE`                                                                      | ✅          | 取自模板                                                                                                                          |
| `COMMERCIAL.md`,无占位符                                                      | ✅          | 取自模板                                                                                                                          |
| `SECURITY.md`                                                                 | ✅          | 取自模板                                                                                                                          |
| `CLA.md`(+ 企业 CCLA),CLA Assistant 已启用并设为必过                          | ⚠️ 部分完成 | CLA.md(ICLA + CCLA,中英文)和 `.github/workflows/cla.yml` 已完成;**设为必过检查需要在 GitHub 分支保护中手动开启**,仓库建好后才能做 |
| `CONTRIBUTING.md`                                                             | ✅          | 包含 CLA、提交规范、依赖白名单                                                                                                    |
| `TRADEMARKS.md`                                                               | ✅          |                                                                                                                                   |
| 所有源文件 SPDX 头;SDK 包 Apache-2.0;`reuse lint` 通过                        | ✅          | `check-spdx` 检查 115 个文件,`reuse lint` 符合 REUSE 3.3                                                                          |
| `package.json` 的 `license` / `author` 正确;SDK 包有 Apache-2.0 LICENSE       | ✅          | 由 `check-spdx` 检查;3 个 SDK 包的 LICENSE 与 apache.org 官方文本 SHA-256 一致。目前还没有 Cargo.toml(M10 才有)                   |
| CI 检查无占位符残留                                                           | ✅          | `check-placeholders`(templates/ 与 docs/plan/ 是模板来源,不检查)                                                                  |
| license-checker 白名单在 CI 中强制                                            | ✅          | 自写脚本基于 `pnpm licenses list`,没有引入额外依赖;共 179 个包,唯一的 MPL-2.0 是 Vite 的 lightningcss(开发依赖、未修改),输出警告  |
| Web UI 源码链接、`/api/v1/meta` 的 `license` / `sourceUrl`、IM `/source` 指令 | ⚠️ 部分完成 | 前两项已完成;IM `/source` 要等 M5 渠道。**`sourceUrl` 默认为空**,原因见第四节问题 1                                               |
| Docker 镜像 OCI 许可证与源码标签;发布产物附 SBOM                              | ⚠️ 部分完成 | OCI 标签已加(source 由构建参数传入);SBOM 等发布流程(M5)再做                                                                       |
| README 中英文许可证段落(15.6)                                                 | ✅          | 原文照用                                                                                                                          |
| 第一个外部 PR 合并前确认 CLA 流程跑通                                         | ⏳ 未到时间 |                                                                                                                                   |
| 签第一份商业合同前请律师审阅                                                  | ⏳ 未到时间 | CLA.md 顶部已注明                                                                                                                 |

## 三、未完成项及原因

1. **Docker 构建、compose 启动、镜像 RSS 未在本机验证**:本机没有 Docker。CI 已包含对应任务,推送后可以验证。
2. **CI 未在 GitHub 上运行、CLA Assistant 未设为必过**:仓库还没有远端(GitHub owner 待定)。
3. **Changesets / release-please 未接入**:release-please 依赖 GitHub 仓库与发布流程,打算在第一次发布(M5)前和 GHCR 镜像发布一起接入,M0 先不引入额外依赖。
4. **IM `/source` 指令、SBOM**:分别属于 M5 渠道与发布流程。

## 四、需要业主决定的问题

1. **GitHub owner 与官方源码地址**(计划第 16 节仍待定)。决定之前,`package.json` 不写 `repository`,`sourceUrl` 默认为空(Web UI 页脚只显示许可证、不显示源码链接)。AGPL §13 要求向网络用户提供源码,所以对外部署前必须设置 `AIP_SOURCE_URL`。定下 owner 后,我会把默认值改成官方仓库地址,并补上 `repository` 字段。
2. **全局开发规则 `rule.json` 的适用范围**。这份规则是公司 Java / MySQL 项目用的,我采取的处理是:
   - **采用**:分支命名格式(`feature-AI-Personal-V0.1.0`)、中文提交说明、LF 换行、4 空格缩进 / 120 列、日志格式(`时间 [级别] [位置] {JSON}`)、禁止外键与级联(ADR 0003 中去掉了计划 6.2 草图里的 `REFERENCES … ON DELETE CASCADE`,改为应用层维护)。
   - **没有采用**:main-aicc / main-test / main-prd / develop 的长期分支模型,以及 Java、MySQL、Redis 的专属规则(本项目使用 SQLite,不使用 Redis)。
   - 请确认:这样处理是否可以?特别是 SQLite 中是否允许使用外键。
3. **提交身份**:本机全局 git 身份是公司邮箱,我在本仓库内单独设置了 `尹绪柏 (Theodore Yin) <x19169738916@163.com>`。如果需要用别的身份,告诉我即可。
4. **TypeScript 版本**:选了 6.0.3 而不是 7.0,因为 typescript-eslint 还不支持 7.x。等它支持后再升级,可以吗?
5. **CLA 语言效力**:CLA.md 写的是「中英文如有歧义,以中文版为准」。如果你更希望以英文为准(更接近 Apache 原文),请告诉我。
6. **根目录的原始计划文件** `AI-Personal-开发计划.md`:已复制到 `docs/plan/`,原文件留在根目录,但加进了 `.gitignore`。需要删除的话我来删。
