# NestJS 11.x 与 12.x 兼容性 PoC 结果

## 状态

本文是 [ADR-026](../adr/ADR-026.md) 的 NestJS 版本技术验证证据。ADR-026 已记录并替代 [ADR-003](../adr/ADR-003.md)。本次验证只是框架兼容性 PoC，不代表任何业务功能已实现：PoC 中的幂等、Session 与安全中间件都是为暴露框架行为而写的内存态简化实现，不是技术设计规定的数据库级方案；正式实现尚未开始。

PoC 在仓库外的临时目录执行，源码、依赖与产物均未提交到仓库，`apps/api/package.json` 与 `pnpm-lock.yaml` 未发生任何变更。本文与 ADR-026 是其唯一留存记录。

## PoC 环境

| 项目 | 值 |
| --- | --- |
| Node.js | v24.20.0 |
| pnpm | 11.26.0（PoC 目录未继承仓库 `packageManager` 固定的 11.19.0；两侧 lockfileVersion 均为 9.0） |
| TypeScript | 5.9.3（与仓库 catalog 一致） |
| Zod | 4.5.4 |
| 测试工具链 | vitest 5.0.0、unplugin-swc 1.5.11、`@swc/core` 1.16.2、supertest 7.2.2、`@nestjs/testing` |
| 变体 A | `@nestjs/common`/`core`/`platform-express`/`testing`/`cli` = 11.2.3 / 11.2.3 / 11.2.3 / 11.2.3 / 11.0.24 |
| 变体 B | 同上 = 12.0.1 / 12.0.1 / 12.0.1 / 12.0.1 / 12.0.0 |
| 编译选项 | 与 [apps/api/tsconfig.json](../../apps/api/tsconfig.json) 一致：CommonJS、`moduleResolution: Node10`、strict、`experimentalDecorators`、`emitDecoratorMetadata`、target ES2024 |

两个变体共用同一份源码；逐文件哈希比对显示，除变体 B 额外包含一个「原生 Standard Schema 探针」模块外，`src`、`test`、`probes` 全部文件字节一致。

除 NestJS 四个包与 `@nestjs/cli` 外，PoC 依赖集在两变体完全相同：`zod` 4.5.4、`rxjs` 7.8.2、`reflect-metadata` 0.2.2、`typescript` 5.9.3、`@types/node` 24.13.3、`@types/express` 5.0.6、`supertest` 7.2.2、`@types/supertest` 7.2.1、`vitest` 5.0.0、`unplugin-swc` 1.5.11、`@swc/core` 1.16.2，以及两个 ESM 互操作探针依赖 `cookie` 2.0.1 与 `helmet` 8.3.0。

版本发布时间（npm registry 实测）：

| 版本 | 发布时间 |
| --- | --- |
| `@nestjs/common` 11.2.3 | 2026-08-25 |
| `@nestjs/common` 12.0.0 | 2026-08-27 |
| `@nestjs/common` 12.0.1 | 2026-08-27 |

截至 2026-09-07，npm `latest` 为 12.0.1，尚无 12.0.2 或 12.1.x。

## 验证方法与命令

每个变体分别执行：

```text
pnpm install
pnpm exec tsc --noEmit -p tsconfig.json
pnpm exec tsc -p tsconfig.json
pnpm exec nest build
node scripts/runtime-smoke.mjs <输出文件>.json
node scripts/notfound-probe.mjs
node scripts/capability-probe.mjs
pnpm exec vitest run
node esm-probe/dist/main.js
```

变体 B 另执行 `node scripts/native-probe.mjs`（原生 Standard Schema 探针）。ESM 探针是独立子包，使用 `type: module` 与 `moduleResolution: NodeNext`。

## 结果

### 依赖与导出符号

| 检查项 | 11.2.3 | 12.0.1 | 差异 |
| --- | --- | --- | --- |
| `@nestjs/core` dependencies | fast-safe-stringify、iterare、path-to-regexp 8.4.2、tslib、uid | 同左 | 无 |
| `@nestjs/platform-express` dependencies | cors 2.8.6、express 5.2.1、multer 2.2.0、path-to-regexp 8.4.2、tslib | 同左 | 无 |
| `@nestjs/testing` dependencies | tslib | 同左 | 无 |
| `@nestjs/common` dependencies | file-type 21.3.4、iterare、load-esm、tslib、uid | 新增 `@standard-schema/spec` 1.1.0，file-type 提到 22.0.2 | 2 项 |
| 实际解析的 express / path-to-regexp | 5.2.1 / 8.4.2 | 5.2.1 / 8.4.2 | 无 |
| `@nestjs/common` 导出符号数 | 112 | 114 | 新增 `StandardSchemaValidationPipe`、`StandardSchemaSerializerInterceptor` |
| 四个包删除的导出符号 | — | — | 0 |
| 包 `type` 字段 | 无（CJS） | `module` | 变化 |
| 根入口在 `moduleResolution: Node10` 下可解析 | 是 | 是（`exports` 的 `.` 指向 `./index.js`，根目录仍有 `index.d.ts`） | 无阻断 |
| `require('@nestjs/*/package.json')` | 可解析 | 被 `exports` map 阻断（MODULE_NOT_FOUND） | 变化 |

仓库 `pnpm-lock.yaml` 中 11.2.3 已解析到 express 5.2.1 与 path-to-regexp 8.4.2，说明 Express 5 属于现有基线，不是 12.x 引入的迁移成本。

### 类型检查与构建

| 检查项 | 11.2.3 | 12.0.1 |
| --- | --- | --- |
| `tsc --noEmit` | 通过（exit 0，无输出） | 通过（exit 0，无输出） |
| `tsc -p`（仓库同款 CommonJS 构建） | 通过，产出 CJS | 通过，产出 CJS |
| `nest build` | 通过 | 通过 |
| CLI 自带 TypeScript | 无捆绑冲突 | `@nestjs/cli` 12.0.0 捆绑 typescript 6.0.3，与项目 5.9.3 不同 |

仓库 `apps/api` 的 `build` 使用纯 `tsc`，不依赖 `@nestjs/cli`，因此 CLI 捆绑编译器目前不影响仓库；一旦引入 CLI 就会出现同一份源码由两个 TypeScript 版本处理。

### 运行时契约与安全冒烟（18 项）

同一份源码、同一组探针，进程内 `fetch` 直接请求监听端口：

| # | 用例 | 11.2.3 | 12.0.1 |
| --- | --- | --- | --- |
| 1 | 合法 query 与默认值应用 | 200 | 200 |
| 2 | query 类型错误（`limit=abc`） | 422 | 422 |
| 3 | query 低于长度下限（`q=a`） | 422 | 422 |
| 4 | 缺少 `Idempotency-Key` | 400 | 400 |
| 5 | 首次带 Key 创建 | 201 | 201 |
| 6 | 同 Key 同 rawBody 摘要重放 | 200，`replayed=true` | 200，`replayed=true` |
| 7 | 同 Key 不同摘要 | 409 | 409 |
| 8 | 新 Key 但 body 校验失败 | 422 | 422 |
| 9 | 响应剔除未知内部字段 | 200 | 200 |
| 10 | 响应契约违规净化 | 500，`INTERNAL_ERROR` | 500，`INTERNAL_ERROR` |
| 11 | 登录签发 Session Cookie | 201 | 201 |
| 12 | 带 Cookie 读取当前身份 | 200 | 200 |
| 13 | 无 Cookie 读取当前身份 | 401 | 401 |
| 14 | `trust proxy` 与 `X-Forwarded-For` | 200，回显 203.0.113.9 | 200，回显 203.0.113.9 |
| 15 | 命名通配 `files/*splat` | 200，捕获 `reports/2026-q3.pdf` | 200，捕获同值 |
| 16 | 异步 rejection 净化 | 500，`INTERNAL_ERROR` | 500，`INTERNAL_ERROR` |
| 17 | 未匹配路由 | 404 JSON，但 message 回显请求行 | 404 HTML |
| 18 | 前述写入后仍可读 | 200 | 200 |

把 `requestId`、CSP nonce、Session Token 与 HMAC 指纹归一化后逐字段比对全部 18 项响应（状态码、`Set-Cookie`、CSP、响应头、响应体结构）：**17 项完全一致，唯一差异是第 17 项未匹配路由**。

两版本一致的安全行为：

- `Set-Cookie`：`__Host-session=<token>; Path=/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax`，无 Domain；
- 存储与日志只出现 Token 的 HMAC-SHA-256 指纹，不出现原始 Token；
- 幂等摘要为 rawBody 的 HMAC-SHA-256，输出 64 位十六进制；`rawBody: true` 在两版本都可用；
- CSP 逐响应 nonce，`script-src` 与 `style-src` 均无 `unsafe-inline`；
- 500 响应体只含 `code`、`message`、`requestId`，不含堆栈、原始异常消息或实体内容；
- `@Res({ passthrough: true })` 覆盖状态码（201 到 200 重放）在两版本都生效。

### 测试工具链

| 变体 | vitest 结果 |
| --- | --- |
| 11.2.3 | 2 个测试文件、17/17 通过 |
| 12.0.1 | 2 个测试文件、16/17 通过，唯一失败项为未匹配路由 404 用例 |

装饰器元数据依赖注入在 swc 转换下两版本均正常工作。

### 12.0.1 原生 Standard Schema 探针

变体 B 额外验证 12.x 独有能力，配合 Zod 4.5.4 全部可用：

- `@Body({ schema })` 加全局 `StandardSchemaValidationPipe`（`errorHttpStatusCode: 422` 与自定义 `exceptionFactory`）产出与自研管道一致的 422 契约体，`details` 为 `{ field, issue }` 数组；
- `APP_INTERCEPTOR` 注册 `StandardSchemaSerializerInterceptor` 加 `@SerializeOptions({ schema })` 完成响应序列化，应用默认值、剔除未知内部字段，数组按元素级 Schema 序列化；
- query 参数校验同样返回 422 契约体（例如 `limit=abc`、discriminated union 的 `kind` 非法值）。

变体 A 的 `capability-probe` 实测 `StandardSchemaValidationPipe` 与 `StandardSchemaSerializerInterceptor` 为 `undefined`，`SerializeOptions`、`ClassSerializerInterceptor`、`ValidationPipe` 两版本均存在。同一探针还实测 CJS 互操作：`helmet@8.3.0` 的默认导出在两版本都可用、命名导出都不可用，`cookie@2.0.1` 的类型解析限制见下文，两者在两版本上表现一致。

### ESM 探针

独立 `type: module` 子包（`moduleResolution: NodeNext`）在两版本上都编译并运行成功，输出 `{"moduleSystem":"esm","status":200,"schemaOk":true}`。ESM 不是 12.x 独有能力，不构成本期升级理由。

## 唯一行为差异：未匹配路由

| 项目 | 11.2.3 | 12.0.1 |
| --- | --- | --- |
| 处理路径 | 进入 Nest 异常过滤器（`APP_FILTER`） | 逃出 Nest 管道，由 Express 的 `finalhandler` 处理 |
| Content-Type | `application/json; charset=utf-8` | `text/html; charset=utf-8` |
| 响应体 | `{ code, message, requestId }`，但 `message` 回显 `Cannot GET /api/v1/...` | Express 默认 HTML 错误页，`<pre>Cannot GET ...</pre>` |
| `X-Request-Id` | 有 | 无 |
| CSP | 应用设置的逐响应 nonce CSP | 被 `finalhandler@2.1.1` 覆盖为 `default-src 'none'` |

缓解措施实测结果：

- 12.0.1：在 `app.init()` 之后注册终端 `app.use()` 中间件即可输出契约 JSON 404，且已匹配路由仍返回 200；
- 11.2.3：同样的终端中间件不生效，异常过滤器先接管，必须直接修正过滤器文案。

结论：两个版本都必须显式实现「统一 JSON 404 且不回显请求行」，只是机制不同。11.2.3 的默认行为同样违反统一错误文案要求，因此这是本项目的既有待办，不是升级 12.x 才出现的问题；验收项登记为[测试矩阵](../test-matrix.md) `SEC-006`。

## 与 NestJS 版本无关的发现

- ESM-only 第三方包在 `apps/api` 现有 `moduleResolution: Node10` 下无法解析类型：`cookie@2.0.1`（`type: module` 且仅提供 `exports`）报 TS2307，改用 `NodeNext` 才能解析；`cookie@2` 还把 `parse` 与 `serialize` 改名为 `parseCookie` 与 `stringifyCookie`。该矛盾与 NestJS 主版本无关，引入此类依赖前必须先决定 moduleResolution 或选用 CJS 版本。
- 社区 `nestjs-zod@5.5.0` 的 peerDependencies 只声明 `@nestjs/common ^10.0.0 || ^11.0.0`，尚不支持 12.x。本项目不依赖该包，OpenAPI 与客户端由 Schema Registry 加 Route Registry 自研生成。

## 已知限制

- 未连接真实 PostgreSQL，未验证事务、锁、约束、迁移与审计链；PoC 的幂等与 Session 都是内存态简化实现。
- 未执行浏览器 E2E，未验证 Ant Design 与 Vite 在强制 nonce CSP 下的表现。
- 未验证文件上传（multer）、限流、压缩、CORS 预检、静态资源托管与生产镜像。
- 未做冷启动、吞吐、内存或长稳测量，只有功能性冒烟。
- 12.x 只有 11 天历史与一个补丁版本，本 PoC 不能代表其长期稳定性。
- 未验证 `@nestjs/swagger`、`@nestjs/microservices`、`@nestjs/websockets` 等本项目非目标包。

## ADR 与后续事项

- [ADR-026](../adr/ADR-026.md) 已创建，状态为 Accepted，并标记替代 [ADR-003](../adr/ADR-003.md)；
- 本期锁定 11.2.3，`apps/api/package.json` 与 `pnpm-lock.yaml` 无需变更；
- 升级 12.x 的触发条件与必须完成的工作清单见 ADR-026，升级只能作为独立依赖升级 PR 由人工确认；
- 下一步与本决策无关的阶段 0 门禁仍按技术设计第 14 章执行，包括 Drizzle 与 Nginx 实际补丁与镜像 digest，以及 PostgreSQL 18.6 官方基线的 PGroonga 验证（见 [ADR-025](../adr/ADR-025.md)）。
