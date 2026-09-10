# F-21 本地交审说明

## 基线与范围

工作区 `C:\Users\10348\.codex\worktrees\9d1f\InPulse` 开工干净，fetch 成功后从 `origin/main` `fc7bb681944942cdba49454e130023a16f778222` 创建 `codex/f21-record-lifecycle`。仅实现管理员记录作废/恢复完整纵切片，未开展 F-22，未采用 #89 两份候选端口/聚合读取提案。未操作 D:\InPulse 的工作分支、README 用户修改或三人协作计划。

收尾主线新增纯文档裁定提交后，已无冲突 rebase 到最新基线 `5563bcf4db3ead1103dbf7c04be98160fcd4bff3`。原代码提交 `c5e99a43fb708237a3b7669c372255ad2c5483a2` 改写为下述提交；apps/packages/database 与已验证代码逐字节一致，未重复运行代码测试。新主线没有 F21 业务代码交集，也未据此扩展实现其他路由。

代码提交：`9b5805805bbee6f0ff964fba75d5732701570943`。文档随后独立提交，最终交付 HEAD 由协调消息提供。没有推送、建立 PR 或合并；远端审核、CI 与已授权的最终 squash 由父协调/PR任务负责，本地结果不等于人工 Approval 或 CI 通过。

## 实现

两条 POST：`voidChangeRecord`（/projects/{projectId}/change-records/{recordId}/void）和 `restoreChangeRecord`（同路径 /restore），均在 /api/v1。严格请求只接收去除首尾空白后 1–10000 字符的 reason，If-Match、同源、CSRF 与数据库幂等必需。响应及缓存仅 id/projectId/status/rowVersion，不保存原因或正文为重放内容；摘要覆盖行为相关 If-Match 与规范 body。

AdminHighRiskAuthService 检查当前完整管理员 Session、密码与当前 TOTP 双时间戳五分钟新鲜度。第一次认证在命令入口，实际取得父级/记录锁后再次检查，避免锁等待期间失效仍写入；幂等重放重新检查身份、双时间戳、CSRF 和结果记录可读性，任一门禁失败不泄露缓存。新 Key 对错误当前状态、过期版本返回409。历史父级归档不取消管理员读取及原成功结果重放资格，但新的状态迁移要求真实父级 ACTIVE。

RecordLifecycleService 是 ChangeRecords 单域 Application Service，IdempotencyRunner 创建唯一 UnitOfWork；所有 Repository、审计和投影显式接收相同 TransactionContext。项目→模块→FEATURE 所属功能 FOR SHARE 后锁记录，按 status+row_version 条件更新。MODULE 的历史影响功能与可空来源任务均不是父级门禁，不锁/修改它们作为副作用。归档方相同父到子 FOR UPDATE 与迁移串行。

作废更新 status、最近 voided_at/void_reason、row_version、updated_at；恢复仅更新 status、row_version、updated_at。正式版本、current_payload、code、published_at、作者/处理人、归属、来源、遗留项与转换链接不变。每次成功迁移追加 CHANGE_RECORD_VOIDED/CHANGE_RECORD_RESTORED 审计及原因；该记录全部历史活动更新可见性，再追加脱敏事件；Search 同键 UPSERT 为 ADMIN_ONLY/VOID 或 MEMBER/PUBLISHED。不生成作废/恢复通知，不改变任务、遗留状态或其他业务聚合。

没有新迁移、数据库不变量/角色/权限改动、核心依赖、根脚本、CI 或部署改动。复用现有 PublishedRecordRepository 的白名单内容映射，VOID 读取使用独立 Schema 分支，不把实际状态伪装成 PUBLISHED。

## 读取与前端

listChangeRecords 默认 PUBLISHED，可传 status=VOID（成员404、管理员可发现）；getChangeRecord 与全部历史版本接口允许管理员读取 VOID，普通成员404。ReadableRecord 为 PUBLISHED/VOID 可区分联合：PUBLISHED 不含作废快照，VOID 额外返回最近 voidedAt/voidReason，仅向管理员暴露。恢复后的普通 DTO 不因保留数据库快照继续隐藏或泄露原因。既有发布/修订的 PublishedRecord 响应及其幂等契约未改变。

正式记录页面新增管理员状态筛选、作废/恢复原因弹窗和重认证入口。请求未确定失败保留原因及相同语义 Key；409 先阻止提交，用户加载最新状态并再次明确确认后使用新版本/Key；重认证成功不自动执行状态迁移。成功刷新记录、版本、搜索和活动缓存。VOID 不提供修订/转换入口，仍可查看不可变历史；恢复重新提供普通操作。

F-20 的 previewLeftoverTask/getLeftoverTaskSource 显式 query=none，保持原接口无查询参数，避免复用列表模板时继承 F21 状态筛选。Schema、Route Registry、权限矩阵、OpenAPI 和生成客户端同步，生成物全部由 generator 更新。

## 定向验证

| 范围 | 命令/入口 | 实际结果 |
| --- | --- | --- |
| 生命周期、正式发布/读取、遗留转换真库回归 | API vitest.integration.config.ts：record-lifecycle / record-publication / published-records / leftover-task 四文件 | 63/63（9.51秒）；分别22、12、8、21 |
| 契约/请求严格性/策略/绑定 | api-contract vitest：record-lifecycle / published-records / permissions / validate 四文件 | 42/42 |
| 原因/If-Match/失败重试Key/409显式重载/重认证入口及原正式读取修订 | Web vitest：RecordLifecycleButton / PublishedRecordsView / EditPublishedRecord | 7/7，jsdom 有既有 getComputedStyle pseudo-elements 提示 |
| 路由与权限、生成漂移 | contract:validate、permissions:check、contract:drift | 86路由/86操作通过；5生成物一致 |
| E2E必要运行时编译及受影响类型 | database/api-contract tsconfig.build.json、API tsconfig.json；API tsconfig.test.json/Web tsc -b/E2E tsc --noEmit | 通过；没有根级全量 build |
| 浏览器 | Edge、现有 CSP enforce build+preview；record-lifecycle.spec.ts | 最终1/1（测试11.5秒，总16秒） |
| 相邻浏览器 | 同次前轮 Edge record-publishing.spec.ts | 2/2（独立发布修订/历史、FEATURE来源发布） |
| 局部检查 | git diff --check；仅变更源码经 Prettier API + fs.writeFileSync 格式化 | 通过 |

22条生命周期真库覆盖两轮状态切换、完整版本/遗留快照/CONVERTED原链接与来源任务重开不变；普通成员和管理员详情/版本/显式列表、默认和显式VOID搜索、恢复后既有及新增Activity；双时间戳过期/缺失、锁等待后过期、Session撤销与管理员降权重放拒绝；同Key并发/重放、不同Key竞争/重复状态、摘要原因变化和行版本冲突；三层父级归档实际锁等待，以及恢复投影提交前阻塞归档；作废和恢复各四种副作用故障全部回滚。

真实UI路径：成员创建并发布→管理员真实密码+TOTP登录→作废触发重认证→保留原因再次确认→普通成员404→管理员显式VOID列表发现/旧版本→恢复→成员原版本/遗留原文与搜索重新可读，原因未进入普通正文。截图 `apps/e2e/test-results/f21-restored-member.png` 为未提交本地产物，已检查。

未运行全仓静态检查、全量测试、额外全量本地构建、依赖审计、默认 Chromium 或本批 GitHub CI。既有列表和版本接口暂无分页，本批未扩大为统计/聚合读取功能。

## 失败历史与修复

- 契约首轮2例因缺少Schema/路由按预期失败，实现后通过。
- 初次按旧文档 D:\PostgreSQL\18\pgsql 找不到可执行文件，启动未发生，迁移 ECONNREFUSED。父协调提供现有带PGroonga的运行时后，独占空库bootstrap/CREATE EXTENSION和六条迁移成功。
- 真库首轮10例5失败：生命周期结果的严格Schema误接收完整记录，改为显式四字段白名单；随后两处fixture修改用户角色/功能归档遗漏row_version，补齐后18/18（含相邻读取）通过。没有放宽Schema或数据库约束。
- 来源任务fixture先后触发completed_at一致性与状态历史约束；改为使用现有TaskManagementRepository.transition维护完整状态历史后通过。没有绕过触发器或弱化断言。
- 局部类型检查发现F20两个GET继承了新增列表query，显式保持none后通过；TimeCursorService测试补入ACTIVITY namespace。初次数据库通用tsconfig产生96个旁置本地编译文件，核对为本任务未跟踪产物且均有对应源码后清除；改用tsconfig.build.json。首次E2E启动因database运行时dist缺失而失败，按build配置生成所需包后启动成功。
- 首轮Edge把全局NODE_ENV=test继承到Vite，导致Ant Design弹窗ARIA标题引用旧弹窗并超时；定位后中止后续重复失败，取消全局变量，仅API由现有配置保持test。下一轮F18两例通过，F21因“记录状态”同时匹配nav/select而失败；改为明确combobox定位，最终F21通过。未调整CSP、权限、断言目标或重试次数。

## 数据库交接

二进制：`C:\Users\10348\AppData\Local\Temp\inpulse-f12-pg18\pgsql\bin`，PostgreSQL 18.6 + PGroonga；仅复用二进制，不操作旧F12/F14/F20数据。F21数据目录为 `C:\Users\10348\.codex\worktrees\9d1f\InPulse\.data\f21\pg`，端口55426，loopback trust，仅合成测试数据。

交付前已用 SHOW data_directory 精确核对为上述F21目录，再 pg_ctl -m fast -w stop 正常停库，55426无监听；数据保留。父审核可从该目录重启，按角色URL重新执行同一批定向测试。E2E使用3126/4196，进程已随Playwright退出；本地Edge配置在被忽略的 apps/e2e/.e2e-runtime/f21.config.ts，不提交。没有读取、复制或分享生产Secrets。
