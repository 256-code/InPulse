# F-22 本地交审说明

## 基线与交付

B 岗隔离工作区：`C:\Users\10348\.codex\worktrees\0e4e\InPulse`；分支 `codex/f22-external-links`。开工工作区干净，fetch 后基线为 `5087f0acd81220a99501d62bf009160777ccf542`（F21 #91 已合并）。未操作主工作区的用户 README 或未跟踪协作计划。

代码提交：`45594039a95b778c26bc75b7d403d3a4c1c1d036`。文档独立提交，最终 HEAD 由交接消息提供。只进行本地提交；PR、CI、合并和最终正常关机由父协调/PR任务负责。

## 行为与契约

三条 `/api/v1` 路由：`listExternalLinks`（GET `/external-links/{targetType}/{targetId}`）、`addExternalLink`（POST 同路径）、`removeExternalLink`（DELETE 同路径 `/{linkId}`）。目标严格为 PROJECT、FEATURE、TASK、CHANGE_RECORD；没有客户端 projectId，Workflow 通过目标域公开 QueryPort 读取真实归属，再进行实时成员/管理员鉴权。

GET 返回当前关联、目标 rowVersion 与 writable。POST 只接受严格 `{url}`；DELETE 无 body。写入要求同源、Session/CSRF、If-Match、数据库幂等；新 Key 的重复当前关联明确409，同 Key 同语义重放原成功结果。重放只缓存 projectId/targetType/targetId/linkId/rowVersion，不缓存 URL、安全材料或 Cookie；重新验证当前认证、目标与保留链接实体可读。成功解除后不要求原关联仍存在；父级归档不隐藏已成功结果，VOID 记录普通成员仍404。

项目、功能、任务详情、草稿与正式记录详情均提供 GitHub 关联弹窗。支持粘贴后本地类型预览、多个链接、明确重复提示、解除确认、空态/只读态、新窗口打开与 `noopener noreferrer`。前端所有请求经生成客户端。未确定失败保留输入、语义 Key 与原 If-Match；409 的 needsRefresh 独立保存，刷新失败、关闭重开不会开放旧提交；成功加载最新数据后仍须明确确认。

## 已核对的设计映射

父协调确认（2026-09-10）：数据库 kind 继续 ISSUE/PULL_REQUEST/COMMIT/OTHER；Release URL 存 OTHER，API/前端由已校验路径派生 Release 标签和 tag，Branch/Repository/Compare 同样可存 OTHER。没有新枚举、新迁移、角色调整或 ADR 替代。标准 URL Parser 检查 HTTPS、准确 github.com、userinfo、端口；fragment 删除，query 仅保留 page/q/tab 并排序。持久化 display_url 也使用规范 URL，未知 query/fragment 不进入实体或审计。新增仓库段空白/长度检查，把元数据约束失败转换为422。仅本地解析，不发远程请求、不保存 GitHub Token、标题或状态。

解除只 DELETE 当前类型化关联表行，external_links 实体和完整不可变审计保留。ADR-022 的四张类型化关联表、项目内 UNIQUE、复合 FK 与并发 ON CONFLICT 复用。正式记录只推进 row_version，不改变 current_version、current_payload、旧版本、遗留快照或来源任务。MODULE 的历史影响功能不当作所属父级。真实合并回归验证来源任务关联逐行不变，主任务没有取得来源关联；未实现 #89 聚合读取。

## 事务、锁与共享搜索写入

IdempotencyRunner 创建唯一 UnitOfWork，目标端口、关联写、审计、活动和搜索显式共享 TransactionContext。目标域各自拥有公开 QueryPort/CommandPort：Workflow 不直写其他模块表，CommandPort 在锁内条件递增该域 row_version。

锁序为真实 project → module → 所属 feature → task/record；PROJECT 自身写入先直接 FOR UPDATE，再进行授权的 FOR SHARE，避免两个项目命令共享锁升级死锁。FEATURE 自身在模块后直接 FOR UPDATE；其他目标先父级 FOR SHARE 再目标 FOR UPDATE。锁后重读真实归属与版本；变化返回409。锁等待后再复核成员关系和 Session/CSRF。MODULE 影响功能及来源任务不引入额外父锁或业务修改。VOID 记录管理员可读但写409，普通成员404；归档目标/父级可读但不允许新写。

共享 `PostgresSearchProjectionWritePort` 的实质变化：每次 upsert 经 ExternalLinks 的公开只读 `ExternalLinkQueryPort`，用同一 tx 读取该目标四表当前 URL；raw_text 保留业务源正文，normalized_search_text 由正文与当前 URL 一起规范化。F22 的搜索公开端口用现有目标投影的业务正文刷新目标投影；草稿本来无投影，发布时自动带当前链接。没有单独 EXTERNAL_LINK 投影，因此 F21 的目标 visibility/status 切换直接覆盖链接搜索，也不会在后续修订时丢失链接或污染旧正文。

组合后沿用100000字符容量门禁，不截断。新增安全 SearchProjectionCapacityError（422），F22 及已受影响的项目/功能/任务/正式修订和完成 Workflow HTTP 边界明确映射；失败整事务回滚，解除仍可降低容量。没有 ExternalLinks → Search 的反向依赖。活动只写目标身份及脱敏“添加/解除 GitHub 关联”，不写 URL/正文，F21 继续按同一来源身份迁移可见性；本功能没有通知需求，未新增通知事件。

## 实际验证

| 范围 | 实际命令/文件 | 结果 |
| --- | --- | --- |
| 真实 PostgreSQL | API vitest.integration.config.ts：external-links、search-projection-write、record-lifecycle、record-publication 四文件 | 71/71（10.65秒）：33 + 4 + 22 + 12 |
| F22 真库覆盖 | 四目标CRUD及版本；同Key并发、异Key竞争、重复409、摘要变化、删除重放；项目内实体复用、跨项目隔离；匿名/非成员/移除/撤销Session；安全URL/Release；三层归档锁等待；添加/删除各3种副作用故障回滚；容量添加/后续修订422和解除；正式历史不变/VOID与恢复搜索/后续修订；真实来源任务合并保留 | 包含在33条中 |
| Web | ExternalLinksPanel、PublishedRecordsView、RecordDraftsView、TasksPanel、FeaturesPageView 五文件 | 27/27（5.46秒）；jsdom 有既有 getComputedStyle pseudo-elements 提示 |
| API 单元 | github-url、search-projection.module 两文件 | 17/17（1.74秒） |
| 契约单元 | external-links、permissions、validate 三文件 | 39/39（399ms） |
| 契约/权限/生成物 | contract:validate、permissions:check、contract:drift | 89路由、89操作、5生成物一致 |
| 局部编译/类型 | database/api-contract 的 tsconfig.build.json（浏览器所需运行时）；API tsconfig.json；API tsconfig.test.json --noEmit、Web tsc -b、E2E tsc --noEmit | 全部通过；没有根级全量 build |
| 浏览器 | Edge；现有 CSP enforce build+preview；external-links.spec.ts | 最终2/2（23.2秒），两例各10.8/7.9秒 |
| 格式 | 锁定 Prettier API 对48个变更源码 check；git diff --check | 全部通过 |

浏览器覆盖项目→功能 Release/重复/危险域名→任务双链接/刷新/解除；独立草稿关联→发布保留→正式记录添加→修订→旧版本对比→链接搜索。检查了 `apps/e2e/test-results/f22-task-links.png` 截图（未提交）。代码提交前最后仅移除未使用 import 并按 Prettier 格式化，未更改已验证行为。

未执行全仓静态检查、全量测试、额外全量构建、无关审计、默认 Chromium、本批 GitHub CI 或生产镜像构建扫描；没有将这些写成成功。

## 失败历史

- 契约红测1例因 Schema/路由不存在失败，落库后通过。Web 红测先因组件不存在无法收集，组件完成后2/2。
- 首轮F22真库18例16过：任务fixture使用随机十六进制编号违反编号格式，重复断言重复消费Response。修正后任务fixture又因未写初始状态历史失败，改为复用 TaskManagementRepository.create 的完整事务；未弱化数据库约束。
- 容量新增红测实际返回500；增加安全422错误与受影响HTTP映射后通过。仓库段编码空白新增红测也实际返回500，URL元数据校验后422。
- 补充正式修订fixture最初漏 x-record-version，随后误用 confirmResolveRemainingIssues；修正为既有 x-record-version 与 confirmLeftoverResolved，超限断言进一步校验具体 SEARCH_TEXT_CAPACITY_EXCEEDED，成功修订和旧状态不变均通过。归档锁fixture起初漏 archived_at，被既有CHECK拒绝；补齐完整状态后通过。
- API局部类型检查发现联合path断言不安全，改为直接解析删除path；测试Response.json的unknown改为契约schema.parse。最终局部类型全部通过。
- 首次浏览器运行：记录路径1例通过，另一例120秒超时，因为 runtime.projectTitle 是搜索投影标题而非项目真实名称；改按共享项目编码定位。第二次17.5秒失败是新建任务未选择必填负责人；补充真实UI选择后最终2/2。
- 契约单测首轮38/39，原因是既有Controller扫描硬编码快照遗漏新三路由；保留原全部断言并加入三路由后39/39。
- 全部历史失败如上保留，不声称首轮全绿。

## 数据库与本机交接

PostgreSQL 18.6 + PGroonga；仅复用二进制 `C:\Users\10348\AppData\Local\Temp\inpulse-f12-pg18\pgsql\bin`。独占数据目录 `C:\Users\10348\.codex\worktrees\0e4e\InPulse\.data\f22\pg`，55427、127.0.0.1、max_connections=150、合成trust测试账户。启动前端口空闲；本任务完成 initdb、000_roles、020_pgroonga 和全部6条空库迁移。

父审核可重启（在本工作区执行）：

```powershell
& 'C:\Users\10348\AppData\Local\Temp\inpulse-f12-pg18\pgsql\bin\pg_ctl.exe' -D '.data/f22/pg' -l '.data/f22/postgresql.log' -o '-p 55427 -h 127.0.0.1 -c max_connections=150' -w start
$env:TEST_DATABASE_URL='postgres://cluster_bootstrap@127.0.0.1:55427/app'
pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/external-links.integration.test.ts
```

收尾已执行 SHOW data_directory 并核对精确为本任务 `.data/f22/pg`，随后 pg_ctl -m fast -w stop 正常停止；数据保留。55427/3127/4197 均无监听。E2E 配置仅在忽略的 `apps/e2e/.e2e-runtime/f22.config.ts`，使用 Edge、E2E_API_PORT=3127、E2E_WEB_PORT=4197；服务随Playwright关闭。未读取/复制生产Secrets，未关机。

## 后续

等待父协调独立审核与PR任务正常CI/评审。数据库不新增迁移；共享搜索适配器和容量映射是本批重点复核点。当前列表展示该目标的当前关联，正式历史版本内容保持不可变；链接关联的历史通过不可变审计保留，不把当前关联描述成旧版本快照。没有待定架构裁决阻断本批。
