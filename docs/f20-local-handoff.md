# F-20 本地交审说明

## 基线、范围与状态

工作区开工干净，成功 fetch 后从 main `c7c68819579a269d057131482c35749bab5cea70` 创建 `codex/f20-leftover-task`。F19 PR #85 已 squash，最终交付 d3bf4473bc42a1344904bcd12ec268d3faa0135b 与 merge tree 一致；workspace 34449977136 成功 11m3s、docs 34449977129 成功 11s，最新 CSP Chromium 34/34。以上由父协调核实；按用户授权合并，实际 GitHub 人工 Approval 无，不记成人工评审。

本批只完成遗留项转跟进任务；F21 作废/恢复没有新增入口。无迁移、数据库角色/权限、核心依赖、根脚本或部署改动。代码本地提交为73adfdcf7f28c50c8dbb72f2a0bb899db05cca94，文档独立提交；未推送、建 PR 或执行本批 CI。

## 三条接口与前端

| operationId | 路由 | 行为 |
| --- | --- | --- |
| convertLeftoverToTask | POST /api/v1/projects/{projectId}/change-records/{recordId}/leftover-task | stable leftoverItemId、recordVersion、expectedRowVersion、leftoverExpectedRowVersion、expectedImpactFeatureIds，加 title/assigneeId/priority/dueAt；严格拒绝客户端 scope、description 或状态。If-Match 与记录 expectedRowVersion 必须一致 |
| previewLeftoverTask | GET /api/v1/projects/{projectId}/change-records/{recordId}/leftover-task-preview | 返回当前正式版本遗留全文、双行版本、稳定状态、继承/排除功能名称和有权任务引用。因为这是写入预览，真实父级归档返回409，非成员/非正式记录404 |
| getLeftoverTaskSource | GET /api/v1/tasks/{taskId}/leftover-source | 按真实任务项目实时验证 actor，然后读取关联的 PUBLISHED 记录。项目/模块/功能归档仍可读历史；未关联或来源当前不再 PUBLISHED 时 source=null，不暴露其记录引用；任务不存在/非成员404，匿名/失效401 |

三个响应均 no-store。POST 同源、CSRF、数据库幂等、If-Match、完整安全重放白名单与最小资源上下文均登记。旧路由契约指纹不变；新增路由由 generator 生成 OpenAPI/客户端，排序插入使 OpenAPI diff 部分旧路由块移位，未手改生成物。

正式记录提供“转为新任务”，保留真实 MODULE/FEATURE 范围，预览遗留全文及哪些影响继承/排除；用户确认负责人，可改标题/优先级。任务说明由服务端拼入来源记录编号、正式版本、稳定遗留 ID 与本次精确遗留原文，不能由客户端覆写。成功可跳任务，任务详情可返回来源正式记录；CONVERTED 永远提供原任务链接。

网络/服务错误保留输入并复用同语义 Key；任何任务字段改变产生新 Key。409 阻止继续提交旧预览，刷新后展示最新全文/继承集合，用户必须点击“确认使用最新预览”，保留任务标题与负责人，使用新版本和新 Key。若刷新本身再失败，独立冲突状态仍阻止旧提交，不能因错误从409变成网络异常就绕过确认。在途不能重复提交或关闭弹窗。

## 事务、不变量与权限

LeftoverTaskController 只调用一个 Workflow HTTP Use Case；唯一 UnitOfWork 由 IdempotencyRunner 创建。Workflow 通过 Tasks 的 FollowupTaskCommandPort 与 ChangeRecords 的 LeftoverRecordCommandPort 操作各自领域，所有 Repository/审计/通知/活动/搜索共享显式 TransactionContext。没有事务内网络、嵌套业务事务或跨域内部导入。

按 project→module→所有排序影响功能→record→leftover 取得锁。影响集合含真实 FEATURE 父级或 MODULE 全历史影响，重放另合并保存结果影响。记录锁后重读 scope/影响，不一致释放保存点锁并从头最多三次。当前转换新建任务，此时任务尚无外部可见引用，不锁旧来源任务；新任务端口重复检查的父级/影响锁均已预持有，未在记录锁后发现新前序资源。既有任务引用只做实时授权读取，不新增逆序任务锁。真库验证等归档功能锁时可 NOWAIT 取得记录锁，证明先功能后记录。

遗留项必须属于实际记录且当前正式版本关系仍包含稳定 ID，ACTIVE、无已有链接，三种预期版本匹配。任务初始 TODO/ACTIVE，指派人必须是当前活跃项目成员，编号走既有受限分配端口。插入 leftover_task_links 后条件更新遗留项为 CONVERTED、row_version+1，再条件更新记录 row_version+1 和 updated_at。依据已有聚合并发规则，转换改变记录 DTO 中的 leftoverItem 状态/链接，必须使旧行版本失效；转换不修改标题/正文，不是内容修订，故 current_version 不增、change_record_versions 和 change_record_version_leftovers 全部原样保留。

同事务包含 task.create 审计/活动/任务搜索、leftover.convert 审计/活动/记录搜索版本更新以及负责人通知。复用任务创建通知写入，将事件类型设为 leftover.convert，只通知经服务端成员校验的新任务负责人，不额外重复发送 task.assigned。任务/编号/链接/状态/全部副作用任一失败均回滚，已写链接不会被部分保留。

不同 Key 再转换先验证当前记录项目授权和链接任务真实同项目/模块/功能归属，返回409 LEFTOVER_ALREADY_CONVERTED 与精确任务引用；无权404且 details为空。数据库 leftover_item_id 主键、task_id唯一及复合外键保留为最终防线。同 Key 重放重新验证当前 actor/操作权限、PUBLISHED记录、CONVERTED稳定链接、任务真实归属及所有保存影响资源；允许内容后来修订、清空或回填后合法重放旧结果，不把当前内容版本要求套到已成功重放。任何缺失/撤权均不能泄露旧结果。

MODULE 继承细节由本轮协调明确：仅继承记录影响中锁后仍 ACTIVE 的功能；历史归档影响保留在原记录，全部归档允许新任务无 impact。不能把 MODULE 转 FEATURE，真实 FEATURE 父级归档仍409。expectedImpactFeatureIds 只是用户确认集合并参与幂等摘要，不作权限/来源真相；归档竞态使集合改变返回409。该细节未改变“新任务禁止新增归档影响”不变量，无需新 ADR。

## 实际验证与失败记录

| 范围 | 实际命令/文件 | 结果 |
| --- | --- | --- |
| API 真库 | pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/leftover-task.integration.test.ts test/record-publication.integration.test.ts test/published-records.integration.test.ts test/tasks-api.integration.test.ts | 4文件82/82，11.16秒；其中F20 21例 |
| Web | pnpm --filter @inpulse/web exec vitest run src/features/published-records/ConvertLeftoverTask.test.tsx src/features/published-records/PublishedRecordsView.test.tsx src/features/tasks/TasksPanel.test.tsx | 3文件13/13，最终4.21秒，含刷新失败仍需确认 |
| 契约 | pnpm --filter @inpulse/api-contract exec vitest run test/leftover-task.test.ts test/published-records.test.ts test/permissions.test.ts test/validate.test.ts | 4文件41/41 |
| Registry/权限/生成物 | contract:generate、contract:validate、permissions:check、contract:drift | 83路由/操作，5生成物一致 |
| 定向类型及编译 | API测试类型；契约/API仅E2E所需tsc编译；Web tsc -b；E2E tsc --noEmit | 通过；不是全仓build |
| 导入边界与格式 | check:deps、check:frontend:boundaries；只变更TS文件的eslint/prettier | 486源文件无循环/越界；148前端模块647依赖；定向lint通过 |
| Edge | 现有CSP build+preview，leftover-task.spec.ts + record-publishing.spec.ts | 5/5，51.3秒；F20两范围+跨页409，F18两相邻路径。此后仅加强刷新失败时保留冲突状态，已由上述Web回归验证，未重复浏览器套件 |

F20 21 个真库场景：

1. FEATURE 转换、TODO、指派通知、任务搜索、来源双向链接、版本快照不变。
2. MODULE 同上。
3. ACTIVE+ARCHIVED 混合继承、全归档空继承、源历史影响保留。
4. 陈旧记录/正式/遗留版本、错遗留ID、非成员指派、伪造scope及继承集合不符。
5. 真实项目归档拒绝。
6. 真实模块归档拒绝。
7. 真实 FEATURE 父级归档拒绝。
8. 任务审计失败整体回滚。
9. 任务活动失败整体回滚。
10. 任务搜索失败整体回滚。
11. 负责人通知失败整体回滚。
12. 链接持久化失败整体回滚。
13. 已建任务/链接后转换审计失败整体回滚。
14. 已转换后记录搜索失败整体回滚。
15. HTTP认证/CSRF/同源/If-Match、同Key并发重放、语义变更409、重复任务引用与撤权保护。
16. 不同Key并发转换只生成一个跟进任务/链接。
17. CONVERTED编辑、清空、回填始终同链接且可安全重放；v1快照不变。
18. ACTIVE清空解决后当前版本缺项拒绝，回填复用同ID后可转换。
19. MODULE影响归档真实锁等待，集合改变409、刷新后空继承成功；先功能后记录锁。
20. FEATURE父级归档真实锁等待拒绝；先功能后记录锁。
21. 预览/来源GET的匿名/外项目隔离与有权读取、重复引用不泄漏。

首个契约测试在Schema不存在时失败，随后实现通过。首轮真库12/16通过，4条归档fixture遗漏archived_at被现有CHECK阻止；补齐合法归档数据后只剩混合影响fixture遗漏module_id被NOT NULL阻止，补齐后21/21及相邻82/82通过。Web首次类型检查发现createIdempotencyKey缺少scope，后发现测试mock不完整，均补齐后通过。没有跳过/删除/降低断言；数据库约束未修改。日志中的JSDOM getComputedStyle提示为现有测试环境输出，未导致失败。

## 交付约束

未跑全仓lint/typecheck/build/test、无关审计或本批GitHub CI。未启动F21。父协调要求剩余Edge路径完成后冻结，未扩大测试。独占隔离PostgreSQL已核对目录后正常停止，端口55424释放并保留数据；最终文档SHA随交付消息提供。前端暂不提供到期时间字段，API支持dueAt，任务普通编辑入口可后续设置；不隐藏后端校验失败。
