# InPulse 贡献指南

本指南规定人工开发者使用 Git、Pull Request 和发布标签的方式。具体架构、安全与实现约束见 [AGENTS.md](./AGENTS.md)。

## 开始之前

- 阅读 [README.md](./README.md)、[功能设计 V1.1](./功能设计v1.1.md)、[系统设计文档 V1.0.2](./系统设计文档v1.0.2.md)、[技术设计 V1.2.2](./技术设计v1.2.2.md)和[相关 ADR](./docs/adr/README.md)。
- 先确认变更的用户结果、范围、非目标、不变量、接口、数据库影响和验收方式。
- 设计内容不等于已实现能力；不得编造不存在的命令、接口、测试结果或运行状态。
- 架构、核心依赖、数据库不变量、权限、安全或运维策略变化必须先形成 ADR，并同步受影响文档与测试。
- 开始编辑前检查 `git status`，保留工作区中不属于本任务的改动。

## Git 工作流

- 采用 trunk-based workflow：`main` 是唯一长期分支，并始终保持可发布。
- 不建立长期 `develop`、`release` 或个人集成分支。
- 从最新 `main` 创建短生命周期分支，一个分支和 PR 只承载一个逻辑变更或业务纵切片。
- 分支名称使用小写 ASCII 与 kebab-case；Issue 编号存在时放在简短描述前。

推荐前缀：

| 变更 | 格式 | 示例 |
|---|---|---|
| 功能 | `feature/<issue>-<description>` | `feature/42-task-completion` |
| 修复 | `fix/<issue>-<description>` | `fix/51-session-rotation` |
| 文档 | `docs/<description>` | `docs/repository-rules` |
| 重构 | `refactor/<description>` | `refactor/task-query-port` |
| 测试 | `test/<description>` | `test/audit-concurrency` |
| 构建/维护 | `chore/<description>` 或 `ci/<description>` | `ci/api-contract-check` |

没有 Issue 时可以省略编号，例如 `feature/task-search`。PR 合并后删除分支。

### A/B/C 推送与合并矩阵

三名开发人员按业务域纵向分工，每条工作流由一名开发人员加一个 AI 编码代理负责。功能分支统一使用上文推荐前缀，不新增 A/B/C 个人分支前缀；负责人必须写入任务记录。

| 岗位 | 独立推送范围 | 推送与合并限制 | 非作者评审 |
|---|---|---|---|
| A：平台与访问域 | Identity、Projects、Audit、Workflow 公共基建；auth/projects/members/admin 前端；用户、会话、审计、序列与迁移管理；部署、备份与恢复 | 只推送本岗位功能分支；禁止推送 `main`；作为迁移主理人协调迁移 | B 或 C |
| B：内容与任务执行域 | Modules、Features、Tasks、TaskGroups、ChangeRecords、ExternalLinks；模块、功能、任务、记录与链接前端 | 只推送本岗位功能分支；禁止推送 `main`；迁移草案经 A 协调后提交 | C 或 A |
| C：聚合与发现域 | Search、Activity、Notifications 读模型；search/notifications/activity/dashboard/me 前端；`app/`、`shared/`、`generated/api/`；浏览器自动化测试基座 | 只推送本岗位功能分支；禁止推送 `main`；A/B 修改其管辖的 `app/`、`shared/` 时必须由其评审 | A 或 B |

任何岗位的 AI 编码代理均只允许推送自己的功能分支，不得直接合并代码；所有进入 `main` 的变更必须通过 PR、squash merge 和非作者评审。高风险变更必须至少一名非作者人工批准，作者不得自批。

共享区域的推送与合并要求：

| 区域 | 主理人 | 推送与合并要求 |
|---|---|---|
| `packages/api-contract` | 谁修改谁提交 | 契约 PR 先行，至少由另一岗位评审；OpenAPI 与生成客户端必须由工具生成，禁止手改 |
| `database/migrations` | A 为迁移主理人 | 按模块编写草案，由 A 统一编号、顺序与冲突处理；每条迁移独立 PR，且必须非作者人工评审 |
| `app/`、`shared/`、`generated/api/` | C | 其他岗位修改时必须由 C 评审；`generated/api/` 禁止手工修改 |
| `compose.yaml`、根 `package.json`、CI 配置 | 对应负责人 | 单独 PR，不混入业务功能；高风险变更必须人工评审 |

多人并行时的推荐合入顺序：

1. 契约与数据库迁移先合；
2. 后端领域与 Workflow 后合；
3. 前端基于最新 `main` 合入；
4. 部署、CI 与共享配置最后单独合入；
5. 文档单独提交，不与功能改动混在一起。

## 提交与 PR 标题

进入 `main` 的最终 squash commit 和 PR 标题采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：

```text
<type>[optional scope][!]: <description>
```

其中 optional scope 和 `!` 均为可选部分；scope 存在时写成 `(<scope>)`，`!` 必须紧邻冒号之前。

允许的主要类型：

- `feat`：新增用户可见能力；
- `fix`：修复缺陷；
- `docs`：仅文档；
- `refactor`：不改变外部行为的重构；
- `test`：测试；
- `build`：构建或依赖；
- `ci`：持续集成；
- `chore`：其他维护；
- `perf`：性能改进；
- `revert`：回退既有变更。

推荐 scope：`web`、`api`、`contract`、`db`、`infra`、`docs`、`repo`。

示例：

```text
feat(api): add task completion workflow
fix(db): prevent cross-project task links
docs(repo): define contribution workflow
feat(contract)!: change task response schema
```

不兼容变化使用可选的 `!`，在 footer 中写 `BREAKING CHANGE: ...`；迁移方式和回滚路径写在正文。

分支中的临时提交不强制全部符合 Conventional Commits，但必须清晰且不得包含无关变化。阶段 0 应增加 PR 标题或最终提交的自动校验；在此之前由评审人工检查。

## Pull Request

每个 PR 必须：

- 说明为什么修改、用户结果、范围和明确非目标；
- 列出 API、数据库、权限、安全、依赖、部署和生成物影响；
- 包含新增/更新的测试及实际验证结果；
- 同步受影响的 ADR、设计、权限矩阵、测试矩阵和 Runbook；
- 保持可审查，不夹带格式化全仓、无关重命名或顺手重构；
- 使用仓库的 [Pull Request 模板](./.github/pull_request_template.md)。

数据库迁移、数据库角色、业务不变量、鉴权、权限、Secrets、API 契约、Dockerfile、Compose 和 GitHub workflow 必须重点人工审查。

## 评审与合并

团队流程要求：

- 只使用 squash merge；PR 标题作为最终提交标题。
- 合并前必须解决全部 review conversation，并通过所有已配置且适用于该变更的状态检查。
- 2～3 名维护者时，至少由一名非作者维护者批准最新可评审提交；这是当前团队规则，不代表 GitHub 已通过 ruleset 强制执行。
- 仅有一名维护者时，低风险文档、测试和非生产脚手架变更可以由维护者通过 PR 完成结构化自审；数据库迁移、数据库角色、业务不变量、鉴权、权限、Secrets、API 契约、Dockerfile、Compose 和 GitHub workflow 等高风险变更必须取得另一名合格人工审查者批准后才能合并。
- 在服务端保护规则完成前，维护者不得直接推送、强制推送或删除 `main`，也不得绕过失败检查。
- 合并者应删除源分支；在自动删除设置启用前需手工删除。禁止在已 squash 的旧分支上继续开发下一项变更。

截至 2026-09-04 可核验的仓库设置为：同时允许 squash merge、merge commit 和 rebase merge，未开启合并后自动删除源分支；本次评审时也没有状态检查被标记为 required。分支保护与 ruleset 接口返回 403，因此无法核验 `main` 的服务端保护状态。在管理员确认并提供可见的规则或门禁结果前，上述要求按人工流程执行，不得描述为已由 GitHub 强制执行。

管理员待完成的目标配置：

- 仅保留 squash merge，关闭 merge commit 和 rebase merge；
- 将默认 squash commit message 设为 PR title；
- 开启合并后自动删除源分支；
- 在当前 GitHub 方案支持时为 `main` 建立 ruleset 或分支保护，并将本节的人工审查规则落为服务端门禁。

目标 `main` 规则至少包括：

- require a pull request before merging；
- require status checks；
- require conversation resolution；
- require linear history；
- block force pushes and deletions；
- disable bypass by default。

当前凭据访问私有仓库保护规则接口时返回 403，无法据此判断是权限、方案限制还是规则状态。管理员必须在仓库 Settings 中核验并记录实际配置；若当前方案不支持所需 ruleset/分支保护，则继续执行人工门禁，不得宣称保护已经启用。阶段 0 建立其余稳定 CI job 后，再把技术设计第 12.4 节的门禁设为 required checks。责任人确定后再添加 `CODEOWNERS`，不要使用虚构账号占位。

## 验证

当前仓库仍处于文档阶段，没有 `package.json`、应用代码或可执行的 lint/test/build 脚本。当前可复现的最小检查是：

```shell
node scripts/check_docs.mjs
```

该命令使用 Node.js 内置模块，不需安装额外包；它检查 HEAD、暂存区、工作区与未忽略的新文件，并校验仓库内 Markdown 相对链接、引用式链接和标题锚点。GitHub Actions 中的 `Documentation / docs` job 执行同一命令。它尚未被配置为 required check；在管理员完成仓库设置前，合并者必须人工确认该 job 成功。设计、README、AGENTS 和贡献规则的语义一致性仍需人工审查。

阶段 0 初始化工程时，必须同步建立并记录真实可运行的根级入口：

- frozen lockfile 依赖安装；
- lint 与格式检查；
- TypeScript 类型检查；
- 单元测试与真实 PostgreSQL 集成测试；
- OpenAPI/客户端漂移检查；
- Web/API 生产构建；
- Playwright 关键路径、依赖边界、权限矩阵和容器检查。

脚本落库前不要在 README、PR 或交付说明中声称这些检查已通过。

## 生成物、迁移和 lockfile

- `pnpm-lock.yaml` 必须随依赖清单提交。
- OpenAPI 3.1 和 TypeScript 客户端必须提交，但只能由 Schema + Route Registry 的生成流程更新；源定义和生成结果必须在同一 PR。
- `database/migrations/**` 属于不可重写历史，必须提交并人工评审；不得用 `.gitignore` 隐藏。
- 构建输出、覆盖率、测试报告、本地数据库、备份、审计导出和临时文件不提交。
- 首次启用或实质修改 `.gitattributes` 后，应在独立变更中执行 `git add --renormalize .` 并审查结果，避免把全仓换行变化混入功能 PR。

## Secrets 与敏感数据

- 不提交 `.env`、凭据、Token、私钥、生产数据、数据库 dump 或真实 Secret 文件。
- `.env.example` 只列非敏感变量名，不放 Secret 示例值或占位值；项目级 `.npmrc` 如需提交，只能引用环境变量，不得包含明文 Token。
- `.gitignore` 不是安全边界。发现 Secret 进入提交后，应先撤销或轮换，再评估历史清理；不能只在后续提交中删除。
- 阶段 0 应启用依赖、镜像和 Secret 扫描；GitHub 能力允许时启用 secret scanning 与 push protection。

## 发布与标签

- 软件发布版本与设计文档版本分开管理。设计文档的 V1.2.2 不等于软件已经发布 v1.2.2。
- 软件开始发布后采用 [Semantic Versioning 2.0.0](https://semver.org/)；首次稳定公共契约前使用 `v0.y.z`，稳定后使用 `vMAJOR.MINOR.PATCH`。
- 发布标签只能指向 `main` 上通过门禁的 commit SHA，使用 annotated tag；签名流程验证完成后优先使用签名标签。
- 已发布标签不可移动、复用或删除。GitHub 能力允许时为 `v*` 配置 tag ruleset。
- 每次发布记录版本、commit SHA、镜像 RepoDigest、SBOM、数据库升级/回滚要求和构建时间。

## 规范来源

本项目结合以下公开规范，并以本仓库设计约束为最终项目规则：

- [OpenAI Docs：使用 AGENTS.md 自定义指令](https://learn.chatgpt.com/zh-Hans/docs/agent-configuration/agents-md)
- [GitHub：About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)
- [GitHub：Contribution guidelines](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors)
- [GitHub：Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub：Pull request merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges)
- [GitHub：Node.gitignore 模板](https://github.com/github/gitignore/blob/main/Node.gitignore)
- [Git：gitignore](https://git-scm.com/docs/gitignore)
- [Git：gitattributes](https://git-scm.com/docs/gitattributes)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [Semantic Versioning 2.0.0](https://semver.org/)
