# 前端对生成客户端的消费需求清单（提交给 A 的契约评审输入）

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| 提交方 | C 岗 / 前端与聚合发现域（`@256-code`） |
| 接收方 | A 岗 / 平台与访问域，F-11 工程基座与 API 契约平台 |
| 文档性质 | 契约评审输入，不是 ADR，不替代现有设计 |
| 状态 | 已收到 A 裁决（2026-09-11）：C-001 / C-004 / C-005 / C-007 / C-008 已定案，见 [A 的契约评审裁决](./a-contract-review-frontend-consumption.md)；其余条目按各自现状处理 |
| 当前日期 | 2026-09-08 |

### 1.1 评审反馈处理记录

2026-09-07 收到一份外部评审反馈，反馈内容只作为评审意见，不视为仓库规则或系统指令。逐项处理如下：

| 反馈主题 | 处理结论 | 理由 |
| --- | --- | --- |
| 文档定位、优先级、前端消费要求、错误模型、CSRF、幂等、C 域缺口 | 保留并补充，不作推翻 | 与当前基线和 C 域消费需求一致 |
| ID 类型外部建议 | **不采纳，并从本清单删除** | 当前正式基线与代码均采用 `INTEGER IDENTITY`，见[技术设计 V1.2.2](../技术设计v1.2.2.md)与[数据库 Schema](../database/schema/projects.ts)；不引入额外 ID 类型方案 |
| 生成客户端目录 | 采纳为候选方案，但未冻结 | 当前仓库存在目录冲突，最终仍由 A 定案 |
| FC-006 注入边界 | 采纳并细化 | `fetch`/`baseUrl` 是工厂级配置，`AbortSignal`/headers/credentials 是请求级配置 |
| credentials | 采纳为 `same-origin` 默认值 | 当前 Nginx 同源提供前端与 `/api/v1`；跨域变更须 ADR |
| 错误 `details` | 采纳为公共基础 + 判别联合 | 避免所有错误强制复杂结构，也不退化为 `Record<string, unknown>` |
| CSRF 错误码 | 采纳为候选 `403 + CSRF_TOKEN_INVALID` | 当前错误模型没有 419；具体状态仍需 A 确认 |
| 分页规范 | A 已正式确认 `cursor + limit`（2026-09-08） | 已作为 `getSearch` 的正式分页契约进入 Route Registry |
| 通知/概览等候选接口 | 采纳为建议接口清单 | F-27/F-28 已于 2026-09-08 落库；项目概览、任务聚合、我的任务仍为评审输入 |
| 文档末尾被截断 | 检查原文件 | 正文已包含 FC-070～FC-074，无需补写 |
| 评审状态字段 | 采用默认“待确认”+ 汇总追踪规则 | 避免在 51 条需求表中重复空状态；A 可按编号批注 |

2026-09-08：C 在 `codex/c-activity-notifications` 将 F-27/F-28 的读取、未读数与已读/未读/全部已读路由写入 Schema Registry、Route Registry，并生成 OpenAPI 与前端客户端；通知写路由登记 `csrfPolicy=required`、`idempotencyRequired` 和重放授权策略。活动/通知业务事件尚未由项目创建、任务完成、记录作废/恢复等 Workflow 生产，当前仅完成读写端口与页面纵切片。

## 2. 范围与非目标

### 2.1 本清单范围

本清单说明 C 作为前端消费方，对“由 Schema Registry + Route Registry 生成 OpenAPI 3.1 与 TypeScript Client”所需的能力、类型、运行时行为和验收要求。重点覆盖：

- 生成客户端的 API 形态、导出方式与浏览器兼容性；
- 请求/响应类型、HTTP 状态、错误模型；
- Session、CSRF、幂等与乐观锁的前端消费方式；
- 列表、分页、游标与轮询场景；
- C 域功能所需接口及当前设计缺口；
- 生成物漂移检查与最小验收纵切片。

### 2.2 非目标

本清单不负责：

- 选定具体 OpenAPI 生成器、客户端生成器或 NestJS Zod Pipe/Serializer；
- 定义业务字段的最终名称、具体领域 DTO 或页面交互细节；
- 放宽认证、CSRF、权限、幂等或安全不变量；
- 将本清单当作新的第三份契约真相；
- 替代 Route Registry、Schema Registry、权限矩阵或测试矩阵。

> 本清单中的接口路径、字段名和 operationId 均属于候选输入，在 A 完成契约评审并写入 Schema Registry、Route Registry 后方可视为正式内容。

## 3. 结论摘要

对 A 的开放建议是：在 F-11 契约纵切片开工前，先把下面三项作为生成契约的第一版评审点，否则 C 的前端层无法在生成客户端之上建立统一的请求适配器：

1. 生成客户端的输出位置与公开 API 边界，并消除当前“`packages/api-contract` 含客户端”与“`apps/web/src/generated/api` 是生成客户端目录”的文档冲突；
2. 生成客户端必须从 Route Registry 输出可被前端读取的操作元数据，至少包含 `operationId`、auth、CSRF、幂等、版本与安全流程策略；
3. 统一错误模型必须提供稳定、机器可读的错误码和可用的 `details` 结构，不能只依赖 HTTP 状态码和自然语言 `message`。

## 4. 需求清单

优先级约定：

- `P0`：不满足会阻断 C 的安全/业务正确实现；
- `P1`：不满足会导致前端无法按约定架构落地；
- `P2`：建议满足，可通过后续纵切片补齐。

### 4.1 生成客户端输出边界

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-001 | P0 | 生成物目录与边界必须显式定义；候选方案为契约源与 OpenAPI 生成物在 `packages/api-contract`，TypeScript 客户端生成物在 `apps/web/src/generated/api`；两处均只由生成工具修改 | 确认最终目录，并同步 `系统设计文档 v1.0.2`、`技术设计 v1.2.2`、`CONTRIBUTING.md` 与 `AGENTS.md` |
| FC-002 | P0 | 约定唯一入口，例如 `apps/web/src/generated/api/index.ts`，并保持稳定导出名 | 冻结生成器命名规则：方法名、类型名、枚举、错误类型与路由元数据名称在重新生成时不得随机变化 |
| FC-003 | P0 | 生成客户端必须只依赖浏览器可用的 ESM 模块，不引入 Node-only API、React、TanStack Query、路由或 localStorage | 阶段 0 PoC 必须用 `apps/web` 的 Vite/React 19 项目实际构建验证 |
| FC-004 | P0 | 生成客户端不得自动挂载请求、不得自动写 localStorage、不得建立全局可变单例，也不得在模块加载时产生副作用 | 提供可测试的工厂/函数形式；C 在 `features` 层通过 TanStack Query 调用，不在生成层引入缓存 |
| FC-005 | P1 | 生成产物应可被 Vite 摇树优化，避免 `import` 一个客户端入口时把全部路由与类型逻辑打进主包 | 使用 ESM named exports 与 side-effect-free 模块；阶段 0 检查 web bundle 不因生成客户端明显膨胀 |
| FC-006 | P1 | 生成客户端必须支持工厂级注入 `baseUrl` 与 `fetch`/transport，请求级传入 `AbortSignal`、合法 headers 与 credentials；业务策略由 C 的统一 Adapter 注入 | 明确工厂级与请求级配置边界；生成客户端应透传 headers，不自动注入 CSRF Token、Idempotency-Key 或 If-Match |

### 4.2 操作方法与类型

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-010 | P0 | 每个 Route Registry operationId 生成一个强类型调用函数，函数名与类型名稳定，禁止使用 `any`、`unknown` 兜底成功响应 | 定义 operationId 命名与生成方法名的映射规则；CI 禁止未知/重复 operationId |
| FC-011 | P0 | path 参数、query、headers、body 必须分别有明确类型，且 path 参数不得在编译期被省略 | Schema Registry 必须覆盖 path/query/header/body；生成客户端不能把缺失参数偷偷转成空字符串 |
| FC-012 | P0 | 明确 `2xx` 成功响应类型；`204`/`noBody` 必须返回 `void`，不得尝试 `JSON.parse` 空响应 | 每个 Route Registry 响应必须声明 `body` 或 `noBody`，生成器必须区分 |
| FC-013 | P0 | 所有枚举/状态字段应生成字面量联合类型，不能在客户端被扩宽成 `string` | 验证 discriminated union、`nullable`、`optional`、literal、递归/循环引用在 OpenAPI 3.1 生成链路中可无损映射 |
| FC-014 | P0 | 列表/搜索结果、活动事件、通知事件等可能需要多态联合，必须保留判别字段并支持 TypeScript 收窄，避免组件内强转 | 优先使用明确的判别字段，不要用宽泛 `details: object` 或 `payload: unknown` 表达业务分支 |
| FC-015 | P0 | 所有时间字段统一使用 ISO 8601 UTC 字符串，不生成 `Date`，也不在生成客户端内自动转换时区 | 遵循技术设计“日期统一 ISO 8601 UTC 字符串”；C 在视图层自行格式化 |
| FC-016 | P0 | 按当前正式基线，资源主键使用 `INTEGER IDENTITY`，JSON 中为 `number`；业务编号如 `T-001`、`CR-001` 为 `string`；`rowVersion` 为 `number`；必须区分 null 与 undefined | 确认 ID 类型不得漂移；如未来调整主键类型，必须先走 ADR、迁移和数据库 Schema 变更，不能只改前端类型 |
| FC-017 | P1 | 生成类型必须兼容当前 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax` 配置 | 在 `apps/web` 的 tsconfig 下完成 typecheck；禁止生成器输出需要关闭严格选项才能通过的代码 |
| FC-018 | P1 | 可选字段缺失与显式 `null` 必须区分；表单和 URL 状态不得因类型不可表达而退化为 `any`/`Record<string, unknown>` | 为可能为空的展示字段明确使用 `nullable`，并规定空数组而非 `null` 表达“无数据” |

### 4.3 请求构造、传输与取消

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-020 | P0 | 当前 Nginx 同源部署下，生成客户端默认使用 `credentials: same-origin`，不得依赖组件层补充 Cookie 配置 | 确认同源拓扑；若未来前后端跨域，必须通过 ADR 改为 `include` 并同步 CORS、Cookie 与安全策略 |
| FC-021 | P0 | 客户端必须支持传入 `AbortSignal`，且取消请求不能表现为业务 4xx/5xx | 定义 `RequestAbortedError` 或等价可识别错误；TanStack Query 取消、轮询停止、页面卸载和登录态切换都需要 |
| FC-022 | P0 | 支持显式传入 `X-CSRF-Token`、`Idempotency-Key`、`If-Match`、`X-Request-Id`，并保留调用方提供的其他合法 headers | C 需要在一个统一 adapter 中注入；生成客户端不应悄悄删除或改写这些 header |
| FC-023 | P0 | 生成客户端不得自动重试业务请求，尤其不得自动重试写请求、CSRF 失败请求或 429 | 重试策略属 `features` 层；A 需给出安全重试边界，C 只负责按 Route Registry 策略实现 |
| FC-024 | P1 | 请求参数序列化规则必须明确：数组、重复 query、空字符串、null/undefined、URL path 编码 | 定义与 OpenAPI 一致的 query serialization；避免组件层手写 `URLSearchParams` 造成不同路由语义漂移 |
| FC-025 | P1 | `X-Request-Id` 与服务端 `requestId` 应可透传到前端日志/错误边界，并避免敏感信息进入日志 | 明确请求关联 ID 的生成、传递和日志脱敏边界 |

### 4.4 错误模型与错误码

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-030 | P0 | 生成客户端应将服务端非 2xx 响应统一解析为类型化 `ApiError`，包含 HTTP 状态、`code`、`message`、`details`、`requestId` | 错误响应 Schema 必须纳入 Schema Registry，不能只在 NestJS 层手工构造 |
| FC-031 | P0 | 定义统一 `ApiError` 基础结构，并按错误码提供判别联合 `details`；401/404 等简单错误可省略复杂详情，不能退化为 `Record<string, unknown>` | 定义 `ApiErrorDetails` 联合；校验、冲突、限流、重认证与幂等错误各自使用专用结构 |
| FC-032 | P0 | 前端逻辑必须基于稳定 `code` 而非自然语言 `message`；`message` 可作为安全 fallback 展示文案，但不能参与流程判断 | 定义错误码命名/版本规则，并承诺新增错误码时生成源同步更新 |
| FC-033 | P0 | 候选采用 `403 + CSRF_TOKEN_INVALID`，错误 `details` 至少包含 `retryable`；前端据此最多重签一次并复用原请求的 `Idempotency-Key` | 当前错误模型不存在 419，不建议新增；A 需确认最终 status/code，且重试仅限 Route Registry 允许的业务命令，第二次失败即停止 |
| FC-034 | P0 | 401、403、404、409、422、429 必须按固定语义区分；客户端不得把 404 当权限提示、把 409 当网络错误 | 对照技术设计统一错误模型为每条路由登记实际可出现的错误状态 |
| FC-035 | P0 | 管理员重认证失败/过期必须能被前端识别，以进入密码 + 当前 TOTP 重认证流程 | 定义 `REAUTH_REQUIRED` 或等价稳定码，并说明是否附带剩余有效期/所需原因 |
| FC-036 | P1 | 网络错误、超时、abort、解析错误应作为独立错误类型返回，不能混入 `ApiError` 或导致未处理异常 | 定义前端错误边界可消费的联合错误类型 |
| FC-037 | P1 | 前端不得直接输出原始服务端错误细节或堆栈；日志只记录安全字段 | 生成客户端/适配器应提供脱敏的日志摘要接口或约定 |

#### 4.4.1 推荐错误结构（候选，未冻结）

```ts
type ApiError = {
  status: number;
  code: string;
  message: string;
  details?: ApiErrorDetails;
  requestId: string;
};

type ApiErrorDetails =
  | ValidationErrorDetails
  | ConflictErrorDetails
  | RateLimitErrorDetails
  | ReauthErrorDetails
  | IdempotencyErrorDetails
  | CsrfErrorDetails;

type ConflictErrorDetails = {
  kind: 'VERSION_CONFLICT' | 'STATE_CONFLICT';
  currentRowVersion?: number;
  currentStatus?: string;
};
```

该结构仅为候选输入：401、404 等简单错误可以省略 `details`；需要前端判断的错误（422、409、429、重认证、幂等冲突、CSRF 失败）才使用专用判别分支。最终字段必须由 A 写入 Schema Registry，不得在本文冻结。

### 4.5 Session、CSRF 与一次性安全流程

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-040 | P0 | `issueCsrfToken`、`login`、`logout`、MFA/重认证/恢复码等安全流程必须通过生成客户端调用，不得由前端手工 `fetch` | 这些 operationId 必须进入 Route Registry，且生成客户端不能因“安全流程”而把调用逻辑隐藏在中间件 |
| FC-041 | P0 | 写请求使用当前 CSRF Token；登录成功轮换 Session/CSRF 后，前端必须能重新取得新 Token | 明确 Token 返回位置（body/header）并纳入 Schema；前端不能依赖读取 HttpOnly Cookie |
| FC-042 | P0 | 生成客户端不能自动重签 CSRF、不能无限重试；只有应用层根据稳定错误码执行一次重签并重试 | 明确“CSRF 校验失败且业务/安全状态未消费”在客户端层面如何判断 |
| FC-043 | P0 | `securityFlow` 路由不得发送业务 `Idempotency-Key`，不得把安全材料送入通用幂等记录 | 路由元数据应标出该策略，C 的 adapter 据此省略/禁止错误头 |
| FC-044 | P1 | `logout` 的 204 语义必须由生成客户端表达为只返回 `void`，前端不能因为空 body 报解析错误 | 明确无效 Session 分支与有效 Session 分支的区别不要求客户端解析 Cookie |
| FC-045 | P1 | 登录/受限 Session 调用 `login` 等身份操作返回 409 时，前端要能正确进入“先登出/清 Cookie 再重新预认证”的流程 | 明确该 409 的错误码和前端恢复路径 |

### 4.6 幂等与乐观锁

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-050 | P0 | 生成客户端/路由元数据必须能区分 `idempotencyRequired`、`none`、`securityFlow`，写请求不能由前端手工猜测 | Route Registry 元数据必须生成到客户端可读的 manifest/类型中 |
| FC-051 | P0 | 同一逻辑提交在重试时必须复用同一 `Idempotency-Key`；前端不得为每次网络重试生成新 Key | C 需要在 `features` 层建立“一次用户提交一个持久 Key”的工具；生成层只负责把 header 正确传入 |
| FC-052 | P0 | 幂等契约版本变化、摘要不同或重放门禁不合格返回 409 时，前端应能区分并停止自动重试 | 定义 `IDEMPOTENCY_CONTRACT_MISMATCH` 等错误码，并避免把旧 Key 残留继续发送 |
| FC-053 | P0 | 乐观锁更新需显式支持 `If-Match: rv:<rowVersion>`，`409` 后 C 需要重新加载并保留用户输入 | 每个带 rowVersion 的更新路由必须在 Route Registry 声明 versionPolicy；生成类型应提供明确参数 |
| FC-054 | P1 | 原子完成/创建类命令的响应类型应包含可直接用于后续导航/刷新结果的资源标识 | 不要求前端解析 409 后自行构造资源；A 应确保幂等重放的 2xx body 与首次执行语义一致 |

### 4.7 分页、游标、轮询与聚合读取

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-060 | P0 | V1 统一采用 `cursor + limit`，响应使用 `items`、`nextCursor`、`hasMore`；不混用 `page/pageSize` 或 `offset/limit` | A 已于 2026-09-08 正式确认 `{ items, nextCursor, hasMore }`；固定表格分页如确有需要，须作为显式例外另行登记 |
| FC-061 | P0 | 游标必须作为不透明字符串暴露，前端不得解析其内部编码，也不得排序或修改 | A 已于 2026-09-08 正式确认：生成类型将 cursor 与业务 ID 分开；服务端负责 HMAC 签名、校验与过期 |
| FC-062 | P0 | 游标响应必须提供明确的 `nextCursor`/`hasMore`（或等价字段）和当前页数据；无更多数据时不要混用 `null` 与空数组 | 定义空列表、首屏、最后一页在 C 的 TanStack Query infinite query 中可直接消费的形式 |
| FC-063 | P1 | 通知轮询需要支持 `AbortSignal`、停止轮询、避免无限游标回跳，并可从当前游标继续增量拉取 | 通知接口应返回稳定的排序键、cursored 游标和可恢复语义 |
| FC-064 | P1 | 搜索应支持项目/模块/功能/状态/负责人等筛选参数，并明确参数编码和最大长度；前端的 URL 状态才能稳定映射 | 不要把搜索条件全部压成一个自由 JSON 字符串；至少对可分享筛选定义 query schema |
| FC-065 | P1 | 项目概览、任务聚合组、我的任务等聚合读接口应尽量由服务端返回，前端不得按项目逐次请求再合并全量数据 | 给出聚合接口的边界，或明确在路由中登记稳定的 server-side aggregation 操作 |

#### 4.7.1 分页 envelope（A 已正式确认，2026-09-08）

```ts
type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};
```

查询参数为 `cursor?: string` 与 `limit?: number`，每个接口必须登记最小值、最大值与默认值。A 已于 2026-09-08 正式确认该 envelope 与不透明游标方向，并已在 `GET /api/v1/search` 的 Route Registry 落库，C-006 关闭。该 envelope 作为 V1 列表游标契约；其他未登记列表接口仍须逐路由进入 Registry 后才能视为正式接口。

2026-09-08：A 反馈确认 `{ items, nextCursor, hasMore }` 与不透明游标方向；
C 在 `feature/c-search-api-contract` 继续落地 `SearchQueryRequest`、
`SearchItem`、`SearchPage`、`GET /api/v1/search` Route Registry、OpenAPI 与
生成客户端，并在服务层实现 `hasMore`、HMAC 签名游标、绑定用户/查询和过期
校验。该分支已由 A 正式确认并合入 Route Registry，C-006 关闭；
`SearchPage`/`nextCursor`/`hasMore` 为正式定案。前端仍不得解析
`cursor` 内部内容，服务端负责签名、校验与过期，正式 TTL 为
15 分钟；无效或过期请求返回 `422`。

2026-09-08：C 在 `codex/c-search-page` 完成搜索页面最小纵切片：`features/search` 通过生成客户端 `getSearch` 消费 `SearchPage`，页面路由 `/search` 与顶部全局搜索框接入 `q`，使用 `useInfiniteQuery` + `nextCursor` 分页；不增加未登记筛选参数，不解析 `cursor` 内部内容。真实登录流程尚未接入，因此页面先以 401 状态提示登录，路由暂不声明 `requiresAuth`，避免未接入的守卫阻断页面。

2026-09-08：C 在 `dev/c` 工作区继续接入真实认证：`features/auth` 的 `AuthProvider` 在挂载时通过生成客户端调用 `getCurrentUser`，匿名时调用 `issueCsrfToken`；登录先签发 CSRF 再调用 `login`，完整登录后刷新当前用户；登出同样先签发 CSRF 再调用 `logout`。新增 `/login` 登录页、AppLayout 用户入口，并将 `/search` 声明为 `requiresAuth`。管理员/普通用户产生的三种 MFA 返回态只显示“尚未接入”提示，不会被当作已认证；真实 HTTP 与 Playwright E2E 仍未执行，当前仅为本地单测验证。

### 4.8 C 域功能与生成客户端具体需求

| 功能 | C 的消费场景 | 对 A/B 契约的评审要求 |
| --- | --- | --- |
| F-23 任务合并 | 提交主/来源任务、分支类型、来源说明；合并后刷新聚合视图 | 合并请求必须登记 `idempotencyRequired`，支持同项目校验、反环、重复合并/重复成员 409；响应应可识别新组与成员 |
| F-24 解除合并 | 提交来源任务与解除原因；触发二次确认 | 已落库 `POST /api/v1/task-groups/unmerge`：请求只含 `sourceTaskId` 与可空 `unmergeReason`；`versionPolicy: none`，并发控制由任务/聚合组行锁与锁后重读实现，状态/竞态冲突返回 409 `TASK_NOT_MERGED`/`TASK_GROUP_STATE_CONFLICT`，校验 422；二次确认对话框属 F-25 前端 |
| F-25 聚合组视图 | 展示主/来源任务、来源状态、迭代记录与 GitHub 链接，支持按分支筛选 | 建议提供 `GET /task-groups/{id}` 或等价聚合读接口；若由 C 组合多个读接口，必须有稳定的 QueryPort 契约且避免 N+1 |
| F-26 全局搜索 | 按类别展示功能/任务/记录/遗留问题，支持筛选和分页 | 搜索响应需保留 `entityType` 判别字段、权限过滤结果、分页与空结果语义；不能返回数据库内部表结构 |
| F-27 项目动态 | 时间线展示脱敏活动、加载更多 | 已落库 `GET /projects/{projectId}/activity`；返回值包含事件类型、实体类型/ID、时间、项目 Scope 和可安全展示的摘要，不包含原始审计快照 |
| F-28 站内通知 | 铃铛未读数、列表、点击跳转、轮询、已读/未读 | 列表、未读数、单条已读/未读与全部已读路由已落库；三个 POST 均登记 CSRF、幂等与重放授权策略 |
| F-29 项目概览 | 统计卡片、最近迭代、遗留问题入口 | 需要服务端聚合响应，避免前端跨域拼装；统计口径与功能设计 §29 一致 |
| F-32 我的任务 | 跨项目列表、状态/范围/是否有记录/负责人等筛选 | 当前设计未明确列出路由与响应 DTO；需用明确的 `GET /me/tasks` 或等价服务端查询，禁止前端按项目请求后合并 |

#### 4.8.1 接口清单与候选接口（F-27/F-28 已落库，F-25/F-29/F-32 待确认）

已落库路由（2026-09-08）：

| 路由 | 用途 | 备注与待确认项 |
| --- | --- | --- |
| `GET /api/v1/projects/{projectId}/activity` | 项目动态时间线 | 已落库；只读 `MEMBER`，系统管理员可用 `includeAdminOnly` 显式包含 `ADMIN_ONLY` |
| `GET /api/v1/notifications` | 当前用户通知列表与轮询 | 已落库；使用 cursor/limit；只能返回当前用户 |
| `GET /api/v1/notifications/unread-count` | 铃铛未读数 | 已落库；只返回当前用户；不实现管理员代读 |
| `POST /api/v1/notifications/{notificationId}/read` | 标记单条已读 | 已落库；登记 `idempotencyRequired`，重复结果可安全重放 |
| `POST /api/v1/notifications/{notificationId}/unread` | 标记单条未读 | 已落库；登记 `idempotencyRequired` |
| `POST /api/v1/notifications/read-all` | 标记当前用户全部已读 | 已落库；禁止客户端传 `recipientId`；登记 `idempotencyRequired` |

以下候选已由 A 于 2026-09-10 裁决（见 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md)）：路径、operationId、状态码与策略已冻结，路由登记、权限矩阵与生成物随实现 PR 落库：

| 候选路由 | 用途 | 备注与待确认项 |
| --- | --- | --- |
| `GET /api/v1/projects/{projectId}/overview` | 项目概览聚合 | 候选归属 C；C 只能通过 A 的 `ProjectAccessQueryPort` 与 B 的公开 QueryPort 或 C 拥有的投影实现，禁止访问 B Repository |
| `GET /api/v1/task-groups/{groupId}` | 任务聚合组详情 | 候选归属需 A/B 确认；如果由 B 提供 QueryPort，C 不得直接访问 B Repository |
| `GET /api/v1/me/tasks` | “我的任务”跨项目列表 | 归属 B 域的公开只读端口加 C 聚合服务；服务端按成员关系过滤，禁止前端按项目合并；固定“负责人 = 当前用户”，不提供 `assigneeMe` 参数 |
| `GET /api/v1/task-groups/{groupId}/records` | 聚合组记录分页（F-25 按分支筛选） | 按 A 裁决 Q-02 新增的子资源路由；`memberTaskId` 过滤，沿用 C-006 游标；只返回 `PUBLISHED` / `VOID`，不返回 `DRAFT` |

### 4.9 生成物、版本与 CI

| 编号 | 优先级 | 需求 | A 侧需要确认/提供 |
| --- | --- | --- | --- |
| FC-070 | P0 | OpenAPI 3.1 与生成客户端必须提交，并由同一生成脚本更新；CI 必须有未提交差异检查 | 阶段 0 建立可在本地和 CI 复现的 `pnpm gen:api`/`pnpm check:api` 或等价根级命令 |
| FC-071 | P0 | 生成脚本应确定可重复，不依赖本地时间、随机值、机器名或未固定版本依赖 | 生成结果应稳定；任何非确定性输出都应在阶段 0 暴露 |
| FC-072 | P0 | 修改 Schema/Route Registry 后必须同步生成客户端，禁止手工修改生成文件 | 生成文件头应有“由工具生成，禁止手工修改”；CI 拒绝未提交差异 |
| FC-073 | P1 | `operationId`、路由元数据、错误码与生成客户端类型应能形成版本化契约清单摘要 | 便于 A 在幂等契约版本升级、跨部署兼容和前端升级时进行评审 |
| FC-074 | P1 | 生成客户端应导出测试可用的 route metadata，而不要求 C 复制一份手写常量 | 避免前端 adapter 与 Route Registry 漂移；元数据也应纳入漂移检查 |

## 5. 阶段 0 最小验收纵切片

建议 A 在 F-11 纵切片中至少用一个真实业务纵切面包来验证下列前端消费能力，而不是只生成一个空客户端：

1. `GET /auth/csrf` → `POST /auth/login` → `GET /me` → 带 CSRF 的写请求 → `logout`；
2. 同一写命令使用相同 `Idempotency-Key` 连续提交，确认只能执行一次且第二次仍获得类型化成功响应；
3. 使用过期 `If-Match` 提交，确认能稳定识别 409 并进入重新加载流程；
4. 一个包含 discriminated union、nullable、ISO 时间、number ID、literal 状态的响应，确认生成类型在 `apps/web` 严格 tsconfig 下可无 `any` 消费；
5. 一个 `204 noBody`、一个错误响应、一个带游标分页的列表，确认生成客户端不会因空 body 或错误解析崩溃；
6. 在 Vite 构建、ESLint 依赖边界和 `pnpm check:docs`/CI 中确认生成客户端无手工修改、无反向依赖、无 Node-only API；
7. 至少一个 Playwright/单元测试验证生成客户端被 `features` 调用且没有组件裸写 `fetch`/`axios`。

## 6. 需要 A 确认的冲突与缺口

以下是当前文档中的未决项，不在本清单内自行定案：

| 编号 | 冲突/缺口 | 依据 | 建议裁决方向 |
| --- | --- | --- | --- |
| C-001 | 生成客户端输出位置冲突 | `技术设计 v1.2.2` 仓库结构在 `packages/api-contract` 写“客户端”；`系统设计文档 v1.0.2` 与 `CONTRIBUTING.md` 指定 `apps/web/src/generated/api/` | 建议以 `apps/web/src/generated/api/` 为前端唯一生成产物，`packages/api-contract` 只保留 Schema/Route Registry 与生成脚本配置；若改共享包需同步所有文档。**A 裁决（2026-09-11）：已接受**，见 [A 的契约评审裁决](./a-contract-review-frontend-consumption.md) §3.1 |
| C-002 | 通知已读/未读接口缺口 | `功能设计 v1.1` §25.3、F-28 有“已读/未读与未读数”；`系统设计文档 v1.0.2` 核心接口表只列 `GET /notifications` | 已关闭：C 已于 2026-09-08 将列表、未读数、单条已读/未读与全部已读写入 Route Registry，并登记 CSRF、幂等和重放授权策略 |
| C-003 | 聚合接口缺口 | F-25、F-29、F-32 均需要服务端聚合/跨项目读取；核心接口表未列出 `task-group` 聚合详情、项目概览、我的任务 | 明确稳定路由与服务端聚合边界，避免 C 在前端逐项拼接。**A 裁决（2026-09-10）**：已接受（转具体 Route），共四条路由进入正式契约；聚合读只允许 A/B 的公开只读端口组合，不接受 C 直读他域业务表；字段级结论见 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md) |
| C-004 | 错误 `details` 结构未定 | 技术设计统一错误模型只给出 `{ code, message, details, requestId }`，未定义 `details` 的具体 Schema；422/409/429/重认证场景需要前端消费 | 为公共错误类别定义稳定 `details` 联合，并在 Route Registry 中按需给出每个错误响应的 Schema ref。**A 裁决（2026-09-11）：已修改接受**——`details` 保持开放对象并冻结保留键 `issues` / `reason`，判别联合延后（恢复条件见裁决 §3.2） |
| C-005 | CSRF 失败识别未定 | ADR-015 要求“客户端仅在服务端明确表示 CSRF 校验失败时重签”，但错误模型未给出专用错误码 | 应定义稳定 `CSRF_INVALID` 或等价机器可读错误码，并避免把 CSRF 失败与普通 403 权限错误混用。**A 裁决（2026-09-11）：已接受**——冻结 `CSRF_ORIGIN_REJECTED` / `CSRF_TOKEN_INVALID` / `MFA_CSRF_REJECTED` / `ADMIN_CSRF_REJECTED`，见裁决 §3.3 |
| C-006 | 分页/游标约定已正式定案（2026-09-08） | 系统设计只写搜索“分页”、通知“游标增量拉取”，未定义公共 envelope 或字段名 | 已关闭：A 确认 `{ items, nextCursor, hasMore }` 与不透明 cursor，并已在 `getSearch` 落库；其他列表接口沿用同一 envelope |
| C-007 | 生成客户端运行时校验策略未定 | 技术设计要求服务端校验，但未规定生成客户端是否对响应做运行时 Zod 校验 | 需决定生成客户端只做类型映射还是运行时校验；若运行时校验，失败需映射为独立错误且不得暴露内部细节。**A 裁决（2026-09-11）：已修改接受**——不引入运行时校验，客户端只做类型映射，见裁决 §3.4 |
| C-008 | `message` 的用户交互语义未定 | 错误模型包含 `message`，但前端逻辑应基于 `code` | 明确 `message` 是用户可展示文案还是仅诊断信息；前端不得依赖文案字符串。**A 裁决（2026-09-11）：已接受**——`message` 是稳定诊断文案（可兜底展示），不是机器契约，见裁决 §3.5 |
| C-009 | ID 类型已按正式基线确认 | 当前[技术设计 V1.2.2](../技术设计v1.2.2.md)、数据库 Schema 与迁移均采用 `INTEGER IDENTITY` | 维持 `number`，不引入额外 ID 类型方案；如未来调整主键类型，必须先走 ADR，并同步迁移、代码、权限矩阵与测试矩阵 |
| C-010 | 候选接口尚未冻结 | 通知/动态已落库；项目概览、任务聚合详情、我的任务路径尚未进入正式契约 | 部分关闭：F-27/F-28 已进入 Route Registry；F-25/F-29/F-32 已由 A 裁决并冻结路径、operationId、状态码、策略与字段名，见 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md)；登记与生成物随实现 PR 落库，在登记完成前仍不得作为实现依据 |

### 6.1 评审状态填写规则

本清单所有需求在 A 评审前默认状态为 `待确认`。A 可按编号在评审记录中填写以下状态：

```text
待确认
已接受
已修改
已拒绝
转 ADR
转具体 Route
```

状态变更后，应同步对应 Schema Registry、Route Registry、权限矩阵、测试矩阵和设计文档；`转 ADR` 的项不得先实现。

## 7. 对 A 的评审请求

请 A 在开始实现 F-11 契约平台前，至少对以下问题给出明确结论：

1. 生成客户端最终落在哪个目录、与 `packages/api-contract` 的依赖关系是什么？
2. 生成客户端采用“纯函数/工厂 + 调用方注入 transport/headers”还是“生成层内置请求客户端”？
3. 生成客户端是否执行响应运行时校验？若执行，校验失败如何处理？（A 答复，2026-09-11：不执行运行时校验，见 [A 的契约评审裁决](./a-contract-review-frontend-consumption.md) §3.4）
4. 错误响应是否按“公共错误模型 + 每路由错误 Schema”组织？`details` 的基准结构是什么？（A 答复，2026-09-11：统一 `ErrorResponse` + 开放 `details` 与保留键；逐路由 ref 与判别联合延后，见 [A 的契约评审裁决](./a-contract-review-frontend-consumption.md) §3.2）
5. CSRF 失败、重认证过期、幂等契约版本冲突、版本冲突、状态冲突分别使用哪些稳定错误码？（A 答复，2026-09-11：CSRF 四码见 [A 的契约评审裁决](./a-contract-review-frontend-consumption.md) §3.3，其余相关码速查见 §3.6）
6. 列表/游标 envelope 已由 F-26 定案；F-27 项目动态与 F-28 通知已读/未读已由 C 落库，项目概览、任务聚合详情、我的任务等路由和 DTO 是否进入 Route Registry？（A 答复，2026-09-10：进入，共四条，含按 Q-02 新增的记录子资源路由；字段级裁决与落库顺序见 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md)）
7. 生成客户端是否需要导出路由元数据（auth/CSRF/idempotency/version）给前端 adapter？
8. 阶段 0 如何最终验证“前端所有 API 调用都经过生成客户端”和“生成物无漂移”？

## 8. 后续步骤

- 若 A 将本清单中的部分条款转为正式设计，应同步 Route Registry/Schema Registry、相关设计文档、权限矩阵、测试矩阵，并优先通过 ADR 处理涉及架构、认证或幂等策略的变化。
- 若本清单中的需求与现有设计冲突，先按“ADR → 功能/系统/技术设计 → 权限矩阵/测试矩阵 → 工作书”的顺序记录冲突，由人工定案后再开工。
- 除 F-27/F-28 已按现有设计落库外，C 在 A 确认项目概览、任务聚合详情、我的任务之前不提前创建对应生成客户端依赖、不手工生成 OpenAPI/客户端文件、不锁定候选生成工具版本。
