# F-18 本地交审说明

## 范围与基线

分支 `codex/f18-record-publishing` 从 `ad6476b7a25bfd504e523908354935ef1dd68949` 新建，开工工作区干净。F-17 PR #79 已合并，本批不重放本地旧提交。本机多次 fetch 因 443 超时或 schannel TLS 握手失败；协调任务于 2026-09-10 再次成功 fetch 并确认远端 main 仍为上述提交，无新主线交集待同步。

本批实现草稿独立发布、正式内容新版本、正式列表/详情/不可变历史与逐字段原文比较，保留 F-17 草稿入口。来源为空或锁内 DONE 方可独立发布；TODO/CANCELED 返回 409。后续来源任务重开不阻止已发布历史修订或合法幂等重放，不改变 task_id、归属、作者或处理人。F-19 组合完成、F-20 转任务入口、F-21 作废恢复入口均未交付。

## 人工确认与不变量

最初暂停遗留映射和发布通知集合的受影响写入，协调提出具体 V1 方案后用户于 2026-09-10 批准，协调明确通知继续。本说明已按批准结果更新，不再将其列为未决。

- 整段非空 remainingIssues 对应同记录唯一稳定遗留项；修改全文沿用 ID。ACTIVE 清空须显式确认解决并转 RESOLVED，再填恢复 ACTIVE。CONVERTED 修改、清空、再填均保留既有状态与转换关联，不创建第二项/第二任务。新独立问题新建记录。
- 每个非空版本追加稳定项 ID 与当时完整文字快照；空版本不插入遗留版本关系，旧版本及转换关系不可覆盖或删除。沿用现有三张表，无新迁移、约束或角色权限修改。
- 发布/正式修订遗留文字最多 10000，草稿继续允许 50000。code/title/四正文完整拼接，经现有 SearchProjection Writer 的原文及 NFKC 规范化长度检查，超限 422，保留输入且回滚编号和全部写入，不截断。测试区分 JavaScript UTF-16 长度与 PostgreSQL 字符数。
- 发布通知作者、处理人、来源任务当前负责人、真实所属功能或 MODULE 影响功能创建者；去重后逐人确认当前项目权限。内容修订按功能 §25.2 仅通知原作者及来源任务当前负责人。没有项目广播。

## 实现与接口

四个 GET：listChangeRecords/getChangeRecord/listChangeRecordVersions/getChangeRecordVersion；两个 POST：publishChangeRecord/createChangeRecordVersion。发布为空请求对象 + If-Match；修订五项内容与 confirmLeftoverResolved + If-Match/X-Record-Version，两版本头进入幂等摘要。DTO 拒绝客户端指定身份/归属/状态。Schema/Route Registry、权限矩阵、OpenAPI、生成客户端同步；正式读取仅依据 PUBLISHED，VOID 隐藏，恢复保留作废快照不影响可见性。

项目→模块→排序功能→来源任务（仅发布）→记录→遗留项锁序；来源锁后变化释放 savepoint 锁并最多重试三次。记录锁内比较 row_version/current_version，版本 INSERT 与当前记录更新及审计/活动/搜索/通知共用一个 TransactionContext。重放重新验证身份、CSRF、权限、可写父级及结果资源归属，拒绝不泄露缓存。

RecordPublicationCommandPort.publish 可供 F-19 在既有事务调用，不创建 UnitOfWork；组合 Workflow 必须先取得完整父级/聚合锁集合并在同事务把来源改为 DONE。FeatureReadPort 增加真实 createdBy，ProjectCodePort 增加事务内 CHANGE_RECORD 编号分配，均无生产依赖变化。没有跨域内部 Repository 访问。

前端使用生成客户端，发布确认、容量错误保留草稿、正式修订失败保留输入和同请求重试键；409 加载最新内容，逐字段冲突选择后使用最新两个版本头保存。清空 ACTIVE 遗留内容必须勾选解决确认。

## 本地验证

仅使用本任务独占 PostgreSQL 18.6 + PGroonga 测试实例，未读取生产数据或 Secrets。未执行全仓静态检查、全量构建、全量测试、依赖审计或本批 CI。

| 范围 | 命令或入口 | 实际结果 |
| --- | --- | --- |
| F-18 发布、读取、F-17 草稿真库回归 | API vitest integration 配置：record-publication / published-records / record-drafts 三文件 | 34/34 通过；F-18 发布 12、读取/编号/锁 8、F-17 草稿 14 |
| 完整搜索容量 | API record-publication-effects.test.ts | 2/2 通过，原文/NFKC/UTF-16 边界 |
| 前端发布内容修订及草稿回归 | EditPublishedRecord / PublishedRecordsView / RecordDraftsView | 9/9 通过，解决确认、网络重试键、409 合并、历史对比 |
| 契约及权限 | api-contract published-records / record-drafts / permissions / validate | 43/43 通过 |
| 生成和策略 | pnpm contract:generate / contract:validate / permissions:check | 78 路由及 78 操作策略通过，生成物由工具更新 |
| 局部编译/类型 | api-contract tsc build、API tsc、API test tsc --noEmit、Web tsc -b、E2E tsc --noEmit | 通过，仅 E2E 所需 API/契约编译和受影响应用检查 |
| 浏览器 | Edge record-drafts + record-publishing | 5/5 通过（54.5 秒），F-17 三路径与 F-18 两路径合跑，无 useAuth 热更新错误 |

真实数据库覆盖四种副作用失败全事务回滚、遗留状态/版本快照不可变、CONVERTED 同链接保留、超长失败保留草稿/编号回滚、并发发布与双版本冲突、当前成员撤权、来源当前负责人通知、任务锁等待后重读、父级归档真实锁等待及 HTTP 同源/CSRF/幂等重放。修复了首次无遗留项 HTTP 发布 500：安全重放白名单漏掉 nullable leftoverItem 的 null 叶子分支，补全合法分支后 12/12 通过。

契约首次 validate 提示未升级版本，原因是本批未提交的新路由在多次生成中保留了过渡指纹；仅恢复 HEAD 已提交指纹后由生成器重建新增路由，保留全部既有路由历史，78 路由验证通过。首轮 Edge 运行时生成客户端触发 Vite 热更新的 useAuth 错误日志，两个业务用例仍通过；随后停止改动源文件再合跑相关路径以排除热更新干扰。不修改运行时鉴权以规避此日志。

## 交付限制与后续

本地功能提交：`1e73db68f92cce75f826150609daca6f65e48733`。交付前再次核对测试实例实际 data_directory 属于本任务，正常停止服务并确认 55424 无监听，保留数据。`pnpm contract:drift` 验证 5 个生成物一致；`pnpm check:docs` 验证 60 个 Markdown 文件及链接/锚点，`git diff --check` 通过。

列表和版本历史为当前最小读取纵切片，尚无分页；没有把设计全量功能声明为已实现。F-20 转换入口未实现，CONVERTED 防线由真实数据库既有转换关系 fixture 验证。无生产依赖或历史迁移变更，不增加根脚本。PR 推送、非作者审查、CI 和合并由协调/PR任务执行，本任务只交本地提交；F-18 合并通知前不开始 F-19。
