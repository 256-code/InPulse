# A 的契约评审裁决：生成客户端消费与统一错误模型（C-001 / C-004 / C-005 / C-007 / C-008）

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| 提出方 | C 岗 / 前端与聚合发现域（[前端对生成客户端的消费需求清单](./frontend-generated-client-consumption-requirements.md) §6、§7） |
| 裁决方 | A 岗 / 平台与访问域（F-11 契约平台） |
| 状态 | 已裁决（2026-09-11）：五项全部定案。C-001 / C-005 / C-008 已接受；C-004 / C-007 已修改接受（判别联合与运行时校验延后，恢复条件见 §3.2、§3.4） |
| 依据 | [消费需求清单](./frontend-generated-client-consumption-requirements.md)、[技术设计 V1.2.2](../技术设计v1.2.2.md) §4.1 / §4.2、[ADR-015](./adr/ADR-015.md)、[ADR-029](./adr/ADR-029.md)、[系统设计文档 V1.0.2](../系统设计文档v1.0.2.md) |
| 范围 | 只裁决 C-001 / C-004 / C-005 / C-007 / C-008；不新增路由、不改状态码语义、不改权限模型、不改数据库；FC 清单其余条目按各自现状处理 |

## 2. 裁决摘要

| 编号 | 议题 | 结论 | 落地 |
| --- | --- | --- | --- |
| C-001 | 生成客户端输出位置冲突 | 已接受：`apps/web/src/generated/api/` 是前端唯一生成客户端目录；`packages/api-contract` 只放 Schema / Route Registry、生成器与 OpenAPI 产物 | 修订 [技术设计 V1.2.2](../技术设计v1.2.2.md) 仓库结构一行（“客户端”改为“客户端生成器”）；`系统设计文档` 与 `CONTRIBUTING.md` 与现状一致，无需改动 |
| C-004 | 错误 `details` 结构 | 已修改接受：`details` 保持开放对象（`Record<string, unknown>`），冻结保留键 `issues` / `reason` 与空对象约定；FC-031 的判别联合延后（恢复条件见 §3.2） | `packages/api-contract/src/contracts/error.zod.ts` 补字段说明并同步 OpenAPI；前端只按 `code` 分支 |
| C-005 | CSRF 专用错误码 | 已接受：冻结四个专用码族（§3.3）；CSRF 失败不得使用 `FORBIDDEN` / `UNAUTHENTICATED` 泛化 | 既有实现与前端映射已符合；测试矩阵登记 |
| C-007 | 生成客户端运行时校验策略 | 已修改接受：不引入运行时 Zod；客户端只做类型映射与最小形状契约，请求/响应校验由服务端负责 | 生成器测试新增断言（无 `zod`、无 `safeParse`） |
| C-008 | `message` 交互语义 | 已接受：`message` 是稳定诊断文案（可直接兜底展示），不是机器契约；前端只按 `code` 分支 | `error.zod.ts` 字段说明并同步 OpenAPI |

## 3. 逐项裁决

### 3.1 C-001：生成客户端输出位置（已接受）

冻结目录与职责：

| 路径 | 内容 | 所有权 |
| --- | --- | --- |
| `apps/web/src/generated/api/`（`client.ts` / `types.ts` / `index.ts`） | 前端唯一生成客户端；只由 `pnpm contract:generate` 更新 | C；禁止手工修改，其他岗位修改须 C 评审 |
| `packages/api-contract/generated/openapi.json`、`route-contract-fingerprints.json` | OpenAPI 3.1 与幂等契约 fingerprint 产物 | A；只由生成器更新 |
| `packages/api-contract/src/**` | Zod Schema Registry、Route Registry、OpenAPI 与客户端生成器源码（`client.ts` 是生成器，不是运行时客户端） | A |

CI 以 `pnpm contract:drift` 按字节比对上述 5 个产物，任何手工修改都会被拒绝。

冲突消除：`技术设计 V1.2.2` 仓库结构把 `packages/api-contract` 描述为“OpenAPI 生成配置、客户端”，容易被读成生成客户端落点；本次修订为“客户端生成器”，与 `系统设计文档 V1.0.2`（`generated/api/` 自动生成客户端与类型）和 `CONTRIBUTING.md`（`generated/api/` 归 C）对齐。

### 3.2 C-004：错误 `details` 结构（已修改接受）

V1 冻结规则：

1. `details` 必填、类型为 `Record<string, unknown>`；无附加细节时必须是空对象 `{}`，不得缺省、不得为 `null`（与技术设计 §4.2 示例一致）。
2. 保留键（frozen，跨路由稳定）：
   - `issues: string`：422 `VALIDATION_FAILED` 的校验摘要（服务端按 `path: message; ...` 拼接）；
   - `reason: string`：该 `code` 内部的稳定原因码（例如 `missing-origin-and-referer`、`login-rate-limited`、`invalid-csrf`、`reauth-expired`、`self-reset`）。同一 `code` 的 `reason` 取值集合属于该错误码契约的一部分，新增取值必须随引入 PR 同步权限矩阵与测试矩阵；
   - 其余键（例如 `query`、`x-csrf-token`、`task`）是字段级 / 资源级明细，只用于表单定位与诊断，键名不得用于业务分支。
3. 前端与生成客户端**只允许按 `code` 分支**（与 C-008 一致）；`details` 只作展示、表单定位与调试。

未采纳（明确延后）：FC-031 的判别联合 `ApiErrorDetails`（`ValidationErrorDetails` / `ConflictErrorDetails` / … 逐类判别）。理由：现有错误发射跨 97 条路由异构（`reason`、字段明细、资源引用、空对象并存），V1 强收窄要么让 OpenAPI 与实际响应不一致（第二真相），要么迫使一次性重发全部错误形状，代价大于收益；且前端真正需要分支的 422 / 409 / 429 / 重认证 / CSRF 场景已可用 `code` + 保留键覆盖。

恢复条件（届时重新裁决，不得静默收窄）：当错误发射统一为“每码固定形状”后，以**新契约版本**引入判别联合，同步登记每条路由的错误响应 Schema ref、生成客户端与前端 adapter，并重新评估 Route Registry 是否改为逐路由 `details` Schema ref。

落地：`packages/api-contract/src/contracts/error.zod.ts` 为 `code` / `message` / `details` / `requestId` 补 `description`，随 `pnpm contract:generate` 写入 OpenAPI 组件；不改变 wire 形状、不改变生成客户端类型。

### 3.3 C-005：CSRF 专用错误码（已接受）

冻结码族：CSRF 失败必须使用下列四个码之一，禁止用 `FORBIDDEN` / `UNAUTHENTICATED` 等泛化码表示：

| code | HTTP | 场景 | `details.reason` |
| --- | --- | --- | --- |
| `CSRF_ORIGIN_REJECTED` | 403 | Origin / Referer / Fetch Metadata 同源校验失败 | `missing-host`、`missing-origin-and-referer`、`cross-origin`、`cross-site`、`unsupported-sec-fetch-mode`、`unsupported-sec-fetch-dest` |
| `CSRF_TOKEN_INVALID` | 403 | 已认证 Session 的同步 Token 缺失、无效或过期（通用码） | `invalid-csrf` |
| `MFA_CSRF_REJECTED` | 401 | MFA 注册 / 验证 / 恢复 / 重认证受限流程内的 CSRF 失败 | `csrf-rejected` |
| `ADMIN_CSRF_REJECTED` | 401 | 管理员高风险流程内的 CSRF 失败 | `csrf-rejected` |

为什么不统一成一个码：`MFA_*` / `ADMIN_*` 流程的错误语义是“受限会话需重建”（401），与已认证 Session 的 403 重签语义不同；但前端**重签判定**统一按上表四码处理（`apps/web/src/features/auth/auth-errors.ts` 已按此映射）。
为什么要保持 403 / 401 而不是 419：错误模型不引入 419（技术设计 §4.2），CSRF 失败属于安全校验失败，沿用 403 / 401。
重试规则（重申 ADR-015，不新增）：仅当服务端以上述码明确表示 CSRF 失败且业务 / 安全状态尚未消费时，客户端可重新签发并**最多重试一次**，不得循环刷新；`idempotencyRequired` 与版本化路由复用原 `Idempotency-Key` / `If-Match`；`securityFlow` 路由按 ADR-023 的逐操作恢复路径执行。
`retryable` 字段（FC-033 候选）：不采纳为 `details` 保留键。重试与否是策略而非数据，已由 Route Registry 的 `csrfPolicy` / `securityFlow` 与上表码族共同决定，新增字段会造成同一致信息的双真相；A-7 之前实现的 CSRF 失败 403 与第二次失败即停止的规则不变。

### 3.4 C-007：生成客户端运行时校验策略（已修改接受）

冻结：生成客户端**不做运行时 Schema 校验**。`client.ts` 只负责 URL / query / body 序列化、`fetch`、`response.ok` 判定、JSON 解析与 `ApiError(status, body)`；服务端负责请求与响应校验（响应校验失败统一 500 `INTERNAL_ERROR`，见 ADR-029 与技术设计 §4.2）。

理由：① 服务端已是校验真相，客户端再校验会把 Schema 语义复制成第二真相；② 在客户端打包 Zod 破坏摇树与包体目标，并引入与 CSP / 依赖最小化无关的运行时成本；③ 错误路径必须宽容（网关错误页、空 body、非 JSON），强校验会在故障时制造二次故障。

如需运行时校验：必须独立 ADR（涉及生成工具链、依赖与包体预算），不得由实现方自行放开；优先在 `features` 层对关键字段做局部断言。

验收：`packages/api-contract/test/generation.test.ts` 新增断言——真实 Registry 生成的客户端与类型产物不含 `zod` 依赖与 `safeParse`，错误解析仍走 `JSON.parse`。

### 3.5 C-008：`message` 交互语义（已接受）

冻结：`message` 是**稳定诊断文案**（中文、可直接兜底展示），**不是机器契约**：

1. 前端不得按文案、前缀或语言分支——逻辑分支只允许基于 `code`；
2. 面向用户的更友好文案由前端按 `code` 映射（`apps/web/src/features/auth/auth-errors.ts` 是既有范式）；
3. `message` 不得包含 Secret、SQL、堆栈、内部 ID、用户隐私或其它内部细节（技术设计 §4.2 既有约束）；
4. 排障引用只使用 `requestId`（与响应头 `X-Request-Id` 同值）。

落地：`error.zod.ts` 的 `message` / `code` / `requestId` 字段补 `description` 并随生成写入 OpenAPI。

### 3.6 相关错误码速查（重申既有冻结，非本次变更）

| 场景 | 码（示例） | HTTP |
| --- | --- | --- |
| 重认证缺失 / 过期 | `ADMIN_REAUTH_REQUIRED`（`details.reason = reauth-expired`）、流程会话缺失为 `ADMIN_REAUTH_SESSION_REQUIRED` | 403 |
| 重认证状态冲突 | `REAUTH_STATE_CONFLICT`、`MFA_VERIFY_CONFLICT`、`MFA_RECOVERY_CONFLICT` | 409 |
| 幂等：同 Key 不同请求 / 契约版本 / Key 版本 | `IDEMPOTENCY_REQUEST_MISMATCH`、`IDEMPOTENCY_CONTRACT_MISMATCH`、`IDEMPOTENCY_KEY_VERSION_MISMATCH` | 409 |
| 幂等：并发进行中 | `IDEMPOTENCY_IN_PROGRESS` | 409 |
| 乐观锁版本冲突 | 各域 `*_VERSION_CONFLICT`（如 `RECORD_VERSION_CONFLICT`、`FEATURE_VERSION_CONFLICT`、`ADMIN_USER_VERSION_CONFLICT`） | 409 |
| 状态冲突 | 各域 `*_STATE_CONFLICT`（如 `RECORD_STATE_CONFLICT`、`FEATURE_STATE_CONFLICT`） | 409 |
| 限流 | 各域限流码（如 `login-rate-limited` 对应的 429 响应） | 429 |

这些码已是实现事实并已被测试覆盖；本表只是重申，避免前端猜测。

## 4. 同步与兼容性

- 契约与生成物：`error.zod.ts` 增加字段说明，`pnpm contract:generate` 重生成 OpenAPI 与 fingerprint 历史；`contract:drift` 无漂移。
- 文档：[消费需求清单](./frontend-generated-client-consumption-requirements.md) §6 / §7 状态更新；[技术设计 V1.2.2](../技术设计v1.2.2.md) 仓库结构；[测试矩阵](./test-matrix.md) A-2 章节；工作书 A-2 行与[开发日志](../开发日志.md)。
- 不改动：路由与 operationId、状态码语义、权限矩阵、数据库、生成客户端 TypeScript 类型（描述不改变类型）；`details` 在 wire 上仍是开放对象。
- 兼容性：无破坏性变更；前端消费仍按既有 `ApiError.status` / `code` / `details` / `requestId`。

## 5. 验收（本地，2026-09-11）

- `pnpm contract:generate` 与 `pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`；
- `packages/api-contract` 单测（含新增 C-007 断言）与 `pnpm test:unit`；
- `pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm check:docs`、`pnpm check:secrets`；
- 明细见[测试矩阵](./test-matrix.md) A-2 章节与[开发日志](../开发日志.md) 2026-09-11 A 条目。

## 6. 后续

- FC-031 判别联合的恢复条件见 §3.2；恢复时先新增裁决与契约版本升级，再动实现。
- C 侧接线不得依赖未冻结项：只按 `code` 分支；CSRF 重签按 §3.3 码族并最多重试一次；`details` 仅作展示与表单定位。
