import {
  recordDraftRoutes,
  taskRecordDraftRoutes,
} from "./record-draft-routes.js";
import { featureRoutes } from "./feature-routes.js";
import { taskRoutes, moduleTaskRoutes } from "./task-routes.js";
import { apiBasePath, type RouteDefinition } from "./route-definition.js";
import { moduleRoutes } from "./module-routes.js";
import { adminUserRoutes } from "./user-admin-routes.js";
import { projectMemberRoutes } from "./project-member-routes.js";
import { projectRoutes } from "./project-routes.js";
import {
  publishedRecordRoutes,
  recordPublicationRoutes,
} from "./published-record-routes.js";

export * from "./route-definition.js";

/**
 * Route Registry 是 method、path、operationId、状态码、Content-Type、鉴权、
 * CSRF、幂等与并发策略的唯一来源。只登记已实现的路由：Controller 未注册时
 * validateRouteRegistry 失败，未实现的规划路由不得提前登记。
 */
export const routeRegistry = [
  ...adminUserRoutes,
  ...projectMemberRoutes,
  ...projectRoutes,
  ...moduleRoutes,
  ...featureRoutes,
  ...taskRoutes,
  ...recordDraftRoutes,
  ...publishedRecordRoutes,
  ...recordPublicationRoutes,
  ...taskRecordDraftRoutes,
  ...moduleTaskRoutes,
  {
    method: "GET",
    path: "/health",
    operationId: "getHealth",
    summary: "存活探针，不访问数据库，不需要认证。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "HealthResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/health/live",
    operationId: "getHealthLive",
    summary: "存活探针，只确认进程事件循环正常，不访问数据库。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "HealthResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/health/ready",
    operationId: "getHealthReady",
    summary: "就绪探针：验证数据库可连接且迁移版本存在，未就绪返回 503。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "HealthResponse" },
          ],
        },
      },
      "503": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/auth/csrf",
    operationId: "issueCsrfToken",
    summary:
      "匿名或已登录用户签发一次性同步 CSRF Token；匿名时创建预认证 Session。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "CsrfIssueResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "none",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "每次签发新 Token 并轮换匿名预认证 Session，数据库只保存 Hash；已登录 Session 复用同一 Session 并最多保留 4 个有效 Hash",
      clientRecoveryPath: "再次调用签发端点",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/me",
    operationId: "getCurrentUser",
    summary: "返回当前登录用户资料；身份由服务端从 Session Cookie 解析。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "CurrentUserResponse",
            },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/users",
    operationId: "getUserDirectory",
    summary:
      "读取全部启用用户的轻量目录，用于创建项目时选择初始成员；只返回 id、姓名、头像与管理员标记。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "UserDirectoryResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/login",
    operationId: "login",
    summary:
      "只接受匿名预认证 Session 与 X-CSRF-Token；成功后消费预认证 Session、轮换 Cookie 并签发新认证 Session 与 CSRF Token。",
    request: {
      path: "none",
      query: "none",
      headers: "LoginHeaders",
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "LoginRequest" },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "LoginResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "none",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一匿名预认证 Session 与其 CSRF Hash 只能成功登录一次；成功时在同一事务条件消费预认证 Session，并创建新的认证 Session 与 CSRF Hash",
      clientRecoveryPath:
        "若已有认证/受限 Session 先登出或清 Cookie，再重新调用 CSRF 签发端点并登录",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/logout",
    operationId: "logout",
    summary:
      "有效 Session 验证同源与当前 CSRF Token 后在事务内撤销；无效或已撤销 Session 仅清 Cookie，统一返回 204。",
    request: {
      path: "none",
      query: "none",
      headers: "LogoutHeaders",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
    },
    authPolicy: "none",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "有效 Session 只在同一事务验证 CSRF 后条件撤销；无效或已撤销 Session 的同源重试仅清 Cookie，不执行状态写",
      clientRecoveryPath:
        "直接重试同一登出请求；有效 Session 需先调用 CSRF 签发端点取得当前 Token",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/mfa/enrollment/start",
    operationId: "startMfaEnrollment",
    summary:
      "管理员首次注册 TOTP：按 user → factor → current Session 锁序条件创建新 pending，返回只展示一次 Secret 与 otpauth URI。",
    request: {
      path: "none",
      query: "none",
      headers: "MfaEnrollmentHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "StartMfaEnrollmentRequest",
          },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "StartMfaEnrollmentResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一旧 enrollment generation 只允许一个请求创建新 pending；按 user → factor → current Session 锁序条件更新，失败方返回 409",
      clientRecoveryPath:
        "重新登录读取当前 enrollment generation，再以该 generation 重新开始",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/mfa/enrollment/confirm",
    operationId: "confirmMfaEnrollment",
    summary:
      "确认 TOTP 注册：条件接受 pending Secret 的当前 time-step，启用因子、签发恢复码，并在同一事务撤销受限 Session、轮换为完整 Session/CSRF。",
    request: {
      path: "none",
      query: "none",
      headers: "MfaEnrollmentHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ConfirmMfaEnrollmentRequest",
          },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "ConfirmMfaEnrollmentResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "条件激活对应 ENROLLING generation；恢复码 Hash 一次签发、原子失效旧批次，旧 Session 撤销并轮换新 Session/CSRF",
      clientRecoveryPath:
        "清 Cookie 后重新登录；若因子已激活，完成 MFA 后于下一 time-step 重认证并轮换恢复码",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/mfa/verify",
    operationId: "verifyMfa",
    summary:
      "管理员完成当前 TOTP 验证：条件接受未使用 time-step，并在同一事务将 MFA_CHALLENGE Session 升级为 AUTHENTICATED。",
    request: {
      path: "none",
      query: "none",
      headers: "VerifyMfaHeaders",
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "VerifyMfaRequest" },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "VerifyMfaResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一 ACTIVE 因子的未使用 TOTP time-step 只接受一次；成功时在同一事务将当前 MFA_CHALLENGE Session 条件升级为 AUTHENTICATED 并刷新 last_accepted_step",
      clientRecoveryPath:
        "若响应丢失且 Session 已升级，读取当前用户；仍为 MFA_CHALLENGE 时于下一 time-step 重新验证",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/mfa/reauthenticate",
    operationId: "reauthenticateAdmin",
    summary:
      "完整管理员 Session 使用密码与当前未使用 TOTP 完成重认证，并在同一事务刷新两个新鲜度时间戳与一次性 rotation generation。",
    request: {
      path: "none",
      query: "none",
      headers: "ReauthenticateAdminHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ReauthenticateAdminRequest",
          },
        ],
      },
    },
    responses: {
      "204": { noBody: true },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一完整 Session 的密码与 ACTIVE 因子当前未使用 TOTP time-step 条件通过；成功时同一服务端事务时间原子刷新 reauthenticated_at、mfa_verified_at 并递增 recovery_rotation_generation",
      clientRecoveryPath:
        "响应丢失后在下一 TOTP time-step 重新认证；若已进入下一高风险操作，由 RequireReauthGuard 按 5 分钟窗口判断",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/auth/mfa/recovery-codes/rotate",
    operationId: "rotateMfaRecoveryCodes",
    summary:
      "完整管理员 Session 在 5 分钟内完成密码 + 当前 TOTP 重认证后，原子消费该次 rotation generation、失效全部旧恢复码，并只展示一次新恢复码。",
    request: {
      path: "none",
      query: "none",
      headers: "RotateMfaRecoveryCodesHeaders",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "RotateMfaRecoveryCodesResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一完整 Session 只消费一次 reauthenticateAdmin 签发的 recovery_rotation_generation；按 user → factor → Session 锁序条件更新 consumed generation，同一 generation 的竞争者返回 409，并在同一事务失效旧 Hash 后签发新码",
      clientRecoveryPath:
        "响应丢失后不能从 Hash 恢复旧明文；在下一 TOTP time-step 重新调用 reauthenticateAdmin，再于新 generation 轮换",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "auth.mfa_recovery_rotate",
  },
  {
    method: "POST",
    path: "/auth/mfa/recovery-codes/consume",
    operationId: "consumeMfaRecoveryCode",
    summary:
      "管理员密码阶段选择恢复码挑战后，原子消费一个未使用恢复码、失效旧代码集，并将当前 RECOVERY_CHALLENGE Session 升级为完整 Session。",
    request: {
      path: "none",
      query: "none",
      headers: "ConsumeMfaRecoveryCodeHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ConsumeMfaRecoveryCodeRequest",
          },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "ConsumeMfaRecoveryCodeResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "429": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "securityFlow",
    idempotencyExceptionAdr: "ADR-023",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: {
      singleConsumptionOrNaturalIdempotency:
        "同一未使用恢复码 Hash 只被接受一次；按 user → factor → Session 锁序在事务内条件写 used_at 并失效同用户全部旧码，随后条件升级当前 RECOVERY_CHALLENGE Session 并签发新 CSRF",
      clientRecoveryPath:
        "响应丢失且 Session 已升级时重新登录完成 MFA；仍未升级则在下一可用恢复码重试，服务端不保存旧明文",
    },
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "auth.mfa_recovery_consume",
  },
  {
    method: "POST",
    path: "/auth/admin/mfa-reset",
    operationId: "resetAdminMfa",
    summary:
      "另一名已完成密码 + 当前 TOTP 重认证的系统管理员重置目标管理员 MFA：同一事务禁用目标因子、失效恢复码、递增 auth_version、撤销全部 Session 并写审计。",
    request: {
      path: "none",
      query: "none",
      headers: "ResetAdminMfaHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "ResetAdminMfaRequest",
          },
        ],
      },
    },
    responses: {
      "204": { noBody: true },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "adminSessionWithReauthentication",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "admin.mfa.reset",
  },
  {
    method: "GET",
    path: "/search",
    operationId: "getSearch",
    summary:
      "按服务端 AuthorizedProjectScope 搜索当前用户可访问项目中的投影实体；普通输入使用 PGroonga 转义查询，禁止客户端传入授权范围；cursor 为服务端签名、校验并带过期时间的不透明字符串；includeVoid=true 仅供系统管理员显式开启 VOID 可见，普通调用不影响范围。",
    request: {
      path: "none",
      query: "SearchQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "SearchPage" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/projects/{projectId}/activity",
    operationId: "getProjectActivity",
    summary:
      "读取当前用户可访问项目的脱敏动态时间线；SQL 前强制服务端 AuthorizedProjectScope，普通成员只返回 MEMBER，系统管理员可显式包含 ADMIN_ONLY。",
    request: {
      path: "ActivityPath",
      query: "ActivityQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ActivityPage" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/projects",
    operationId: "listProjects",
    summary:
      "读取当前认证用户可见项目；系统管理员返回全部项目，普通用户只返回存在 ACTIVE 成员关系的项目，包含归档历史；SQL 前使用服务端 AuthorizedProjectScope，不接受客户端传入授权范围。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "ProjectListResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/projects/{projectId}",
    operationId: "getProject",
    summary:
      "读取当前用户可访问的单项目摘要；系统管理员可访问全部项目；不存在与无权访问统一返回 404；包含归档历史。",
    request: {
      path: "ProjectPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "ProjectDetailResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/notifications",
    operationId: "getNotifications",
    summary:
      "当前用户自己的站内通知列表；SQL 强制 recipient_id=当前用户，cursor 为服务端签名、校验并带过期时间的不透明字符串。",
    request: {
      path: "none",
      query: "NotificationQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "NotificationPage" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "GET",
    path: "/notifications/unread-count",
    operationId: "getNotificationUnreadCount",
    summary: "返回当前登录用户的未读通知数量。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "NotificationUnreadCountResponse",
            },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/notifications/{notificationId}/read",
    operationId: "readNotification",
    summary:
      "把当前用户的一条通知标记为已读；不存在或非本人统一返回 404，重复执行自然幂等。",
    request: {
      path: "NotificationPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "NotificationReplayContext",
        resultRefExtractor: "notificationId",
        currentReadAuthorizer: "notificationOwnerAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/notifications/{notificationId}/unread",
    operationId: "unreadNotification",
    summary:
      "把当前用户的一条通知标记为未读；不存在或非本人统一返回 404，重复执行自然幂等。",
    request: {
      path: "NotificationPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "404": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "NotificationReplayContext",
        resultRefExtractor: "notificationId",
        currentReadAuthorizer: "notificationOwnerAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/notifications/read-all",
    operationId: "readAllNotifications",
    summary: "把当前用户的全部未读通知标记为已读；响应不暴露其他用户资源。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "403": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: { "204": { noBody: true } },
    },
    replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
  {
    method: "POST",
    path: "/projects",
    operationId: "createProject",
    summary:
      "任一启用用户创建项目；创建者自动成为活跃成员且不可取消，可选初始成员；单事务内创建未分类模块并写审计、通知、活动与搜索投影；初始成员无效/停用/重复则整笔回滚。",
    request: {
      path: "none",
      query: "none",
      headers: "CreateProjectHeaders",
      body: {
        contentTypes: [
          {
            contentType: "application/json",
            schemaRef: "CreateProjectRequest",
          },
        ],
      },
    },
    responses: {
      "200": {
        body: {
          contentTypes: [
            {
              contentType: "application/json",
              schemaRef: "CreateProjectResponse",
            },
          ],
        },
      },
      "400": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "401": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "409": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "422": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
      "500": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ErrorResponse" },
          ],
        },
      },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "200": {
          body: {
            responseSchemaRef: "CreateProjectResponse",
            safeBodyFieldPaths: [
              "project.id",
              "project.code",
              "project.name",
              "project.description",
              "project.status",
              "project.rowVersion",
              "project.createdBy",
              "project.createdAt",
              "project.updatedAt",
              "members[].userId",
              "members[].status",
              "members[].joinedAt",
              "unclassifiedModuleId",
            ],
          },
        },
      },
    },
    replayAuthorizationPolicy: {
      version: "1.0.0",
      resources: {
        contextSchemaRef: "CreateProjectReplayContext",
        resultRefExtractor: "projectId",
        currentReadAuthorizer: "projectMemberReadAuthorizer",
      },
    },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "project.create",
  },
] satisfies readonly RouteDefinition[];

export type RegisteredRoute = (typeof routeRegistry)[number];

export function fullPath(path: string): string {
  return `${apiBasePath}${path}`;
}
