# F-17 迭代记录草稿本地交审（2026-09-10）

分支 `codex/f17-record-drafts`，最初基于 F-16 合并 SHA `694c0ebd5260ea5f7cb2c9393cda25347f775a64`，交审前 fetch/rebase 至 `origin/main e362d12`，保留 F-06 与最新视觉。生成文件冲突由合并后的 Schema/Route Registry 重新生成，未手改生成物。代码提交 `b8bec4e0adca1f36949c2a5ee433bbda54bb4d1d`；文档提交随后，最终 HEAD 以交审消息为准。仅本地提交，由协调安排非作者审核和后续交付，不自行推送、PR 或合并。

## 范围与人工定案

本轮完成 FEATURE/MODULE 独立草稿与任务来源草稿创建、列表、详情、继续编辑。三项核心字段与标题必填，遗留问题选填。来源标题默认任务锁后标题；归属、处理人、作者和数据库时间由服务端派生。处理人和 MODULE 影响功能是记录自己的创建快照，内容编辑不追随任务后续修改。其他当前项目成员可编辑，独立记录处理人/作者均为创建 actor。

工作书 F-17 旧条目把 task_id 写为唯一，与三份设计和现有 Schema 的同任务多记录冲突。先记录并暂停受影响实现，继续独立草稿。协调核实后，用户于 2026-09-10 明确“同意”保留既有多记录不变量并纠正工作书；来源部分才继续。每条记录至多一个同项目来源任务，同任务可有多个 DRAFT/正式记录；无隐含每任务最多一 DRAFT、唯一索引或任务 ID 自动去重。同 Key 重放同一创建结果，不同 Key 明确新建另一条；入口列出全部现有草稿供选择，不自动挑选第一条。无需变更 ADR 或数据库迁移。

DRAFT 固定无正式 code、currentVersion=0、publishedAt=null，不写正式版本/编号序列，不改来源任务 TODO/DONE/CANCELED、row_version、完成信息和历史，不发正式投影/活动/通知。草稿本域内容、影响快照与审计同 tx。F-16 实际变化选项接真实来源草稿路径，确认完成按钮仍禁用；发布、正式版本管理和发布并完成留给 F-18/F-19。

## 契约与锁序

七个 operationId：listRecordDrafts、getRecordDraft、createIndependentRecordDraft、updateIndependentRecordDraft、getTaskRecordDrafts、createTaskRecordDraft、updateTaskRecordDraft。全部遵守 Registry/Contract 请求和全局响应校验。写入有 Session、同源/CSRF、数据库幂等和当前结果资源重放授权；来源创建 If-Match 为任务版本，编辑为记录版本。内容 DTO 拒绝身份/状态/关联字段；错误统一且不输出 SQL/堆栈，响应 no-store。

独立草稿走 ChangeRecords 单域服务，来源绑定和编辑走 TaskRecordDraftWorkflow → Tasks TaskQueryPort / ChangeRecords RecordDraftQueryPort、RecordDraftCommandPort。任务 Port 只读自己的数据库表，记录 Repository 不跨域访问。所有端口显式接收同一 TransactionContext，一个命令一个 UnitOfWork。

先锁项目→模块→需要的功能 ID 升序 FOR SHARE（任务当前影响与记录已存影响的并集），再任务 FOR UPDATE，最后记录。任务锁后独立 SQL 重读能看到等待期间提交的关系；与预读不一致时回滚同事务 savepoint 释放本阶段锁，从功能锁阶段最多三次重试。记录版本变化返回409，不能持任务锁追加新的功能锁。真实父级归档禁止写与重放；MODULE 历史归档影响可保留，独立新选影响须 ACTIVE。当前授权仍允许读取归档历史草稿。

## 定向验证

| 命令 / 范围 | 实际结果 |
| --- | --- |
| API `vitest run --config vitest.integration.config.ts test/record-drafts.integration.test.ts test/tasks-api.integration.test.ts` | 55/55，6.17秒；F17 14 + F14/F15/F16 41 |
| Web `vitest run src/features/record-drafts/RecordDraftsView.test.tsx src/features/tasks/TasksPanel.test.tsx` | 14/14：草稿5 + 任务9；必填、显式多草稿、指定编辑、409保留输入与字段合并 |
| api-contract `vitest run test/record-drafts.test.ts test/permissions.test.ts` | 17/17 |
| `pnpm contract:validate` / `pnpm contract:drift` / `pnpm permissions:check` | 72 路由策略/权限、5 个生成物无漂移 |
| Edge `record-drafts.spec.ts` | 同步最新主线、修正 FEATURE 返回路径后 3/3，37.0秒；独立保存/编辑/刷新及 FEATURE/MODULE 两条来源草稿选择、编辑第二条、返回仍 TODO 且只有初始状态历史 |
| Edge `task-status.spec.ts` | 首轮与草稿合跑中两条 F16 状态闭环均通过；无需重复无变化场景 |
| E2E 所需 API-contract/API 局部编译，API 测试/Web/E2E局部类型检查 | 已通过；无全仓构建或静态套件 |

真库覆盖同 Key 重放/不同 Key 多草稿、伪造身份/跨项目/撤权/归档父级拒绝、独立/来源并发编辑与审计回滚、父级归档锁等待、来源更新等待后 savepoint 重试、任务状态/完整历史不变、快照不追随、既有正式记录不阻塞新草稿且正式历史不变。Edge 截图已查看，来源列表两条草稿与选中详情、导航、三段内容及留白正常。

首轮测试未提供 TEST_DATABASE_URL，按设计 fail closed，设置隔离库后执行；来源 fixture 优先级误写 MEDIUM，改用基线 NORMAL 后通过。首轮 Edge 合跑 4/5，FEATURE 返回链接多 `/tasks` 导致404；修正真实前端路径后草稿三例全部通过。保留断言，没有跳过或降级。独立阶段曾单独通过6例真库、3例Web和1例Edge，不把这些较小范围替代来源完整验证。

本批未执行 CI、默认 Chromium、全量本地测试/构建/静态审计或依赖审计。完整阶段0与 F18/F19 未完成，不把本地结果写成 CI 已通过。

## 文档与日志

同步三份设计、工作书、权限矩阵、测试矩阵、契约和生成客户端，无生产依赖/迁移/数据库权限变更。用户进一步明确日志问题是格式不一致，并授权整理历史条目：仅将 B 侧 F14/F15/F16 共9条本地交审、推送和审核修复记录转换为原模板，原文事实、当时失败/未执行/待CI状态和顺序保留；不改 A/C 或 F13之前记录。缺失时间/阶段如实标注，不编造时间或推送次数。最终合并/CI结果另增一条模板补记，基于协调核实的历史证据，不声称本轮重新运行。

## 复核环境与后续

本任务独占 PostgreSQL18/PGroonga `127.0.0.1:55424/inpulse_f14`，数据目录 `%TEMP%\inpulse-f14-610b\data`。启动前确认55424无监听、pg_ctl未运行，显式指定 `-o "-p 55424"`；无其他库操作。测试环境 TEST_DATABASE_URL/E2E_DATABASE_URL 指此隔离库，E2E_API_PORT=3114、E2E_WEB_PORT=4184；Edge用本地忽略的 `.e2e-runtime/playwright.edge.config.ts`，显式 `--project=edge`。不对 Vite 全局设置 NODE_ENV=test。复核结束仅在查明实际 data_directory 后停止本实例，保留数据供协调恢复。

审核重点：公开 Port 边界、来源/记录身份与锁序、同任务多草稿语义、版本/幂等重放门禁以及快照不追随。交审后冻结；任何行为修复增量复核，F18/F19 等待协调派工。

最终交审检查：本批非生成 TS/TSX 格式检查通过；check:docs 验证59个Markdown的链接/锚点与Git空白状态通过。日志专项对比确认163个非B章节未改、原B条目44条事实原文保留、11张模板表格结构正确（9条转换+2条补记）；初次检查发现日志EOF多一个空行，已修正。同步主线后Web定向复跑14/14（3.74秒）。已再次查询实际data_directory确认本任务目录后正常停止55424实例，端口无监听，数据保留供协调复核。
