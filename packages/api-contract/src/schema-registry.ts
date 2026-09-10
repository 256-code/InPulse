import { taskCompletionSchemas } from "./contracts/task-completion.zod.js";
import { taskGroupSchemas } from "./contracts/task-groups.zod.js";
import { recordDraftSchemas } from "./contracts/record-drafts.zod.js";
import { publishedRecordSchemas } from "./contracts/published-records.zod.js";
import { featureSchemas } from "./contracts/features.zod.js";
import { taskSchemas } from "./contracts/tasks.zod.js";
import type { z } from "zod";
import { moduleSchemas } from "./contracts/modules.zod.js";

import {
  confirmMfaEnrollmentRequestSchema,
  confirmMfaEnrollmentResponseSchema,
  loginHeadersSchema,
  loginRequestSchema,
  loginResponseSchema,
  logoutHeadersSchema,
  mfaEnrollmentHeadersSchema,
  reauthenticateAdminHeadersSchema,
  reauthenticateAdminRequestSchema,
  rotateMfaRecoveryCodesHeadersSchema,
  rotateMfaRecoveryCodesResponseSchema,
  consumeMfaRecoveryCodeHeadersSchema,
  consumeMfaRecoveryCodeRequestSchema,
  consumeMfaRecoveryCodeResponseSchema,
  resetAdminMfaHeadersSchema,
  resetAdminMfaRequestSchema,
  startMfaEnrollmentRequestSchema,
  startMfaEnrollmentResponseSchema,
  verifyMfaHeadersSchema,
  verifyMfaRequestSchema,
  verifyMfaResponseSchema,
  currentUserResponseSchema,
  userAuthStateSchema,
} from "./contracts/auth.zod.js";
import { csrfIssueResponseSchema } from "./contracts/csrf.zod.js";
import { errorResponseSchema } from "./contracts/error.zod.js";
import { healthResponseSchema } from "./contracts/health.zod.js";
import {
  activityItemSchema,
  activityPageSchema,
  activityPathSchema,
  activityQueryRequestSchema,
} from "./contracts/activity.zod.js";
import {
  notificationItemSchema,
  notificationPageSchema,
  notificationPathSchema,
  notificationQueryRequestSchema,
  notificationReplayContextSchema,
  notificationUnreadCountResponseSchema,
} from "./contracts/notification.zod.js";
import {
  searchItemSchema,
  searchPageSchema,
  searchQueryRequestSchema,
} from "./contracts/search.zod.js";
import {
  createProjectHeadersSchema,
  createProjectReplayContextSchema,
  createProjectRequestSchema,
  createProjectResponseSchema,
  projectMemberItemSchema,
  projectMemberCollectionPathSchema,
  projectMemberPathSchema,
  projectMemberRecordItemSchema,
  projectMembersListResponseSchema,
  addProjectMemberRequestSchema,
  projectMemberMutationHeadersSchema,
  projectMemberUnfinishedTaskItemSchema,
  projectMemberUnfinishedTasksResponseSchema,
  projectMemberReassignmentItemSchema,
  removeProjectMemberRequestSchema,
  addProjectMemberResponseSchema,
  removeProjectMemberResponseSchema,
  projectMemberReplayContextSchema,
  projectCodeSchema,
  projectItemSchema,
  projectListResponseSchema,
  projectDetailResponseSchema,
  projectPathSchema,
  projectEditRequestSchema,
  projectMutationHeadersSchema,
  projectVersionHeadersSchema,
  projectReplayContextSchema,
  projectArchiveRequestSchema,
  projectArchivePreviewResponseSchema,
} from "./contracts/projects.zod.js";
import {
  adminUserCreateRequestSchema,
  adminUserItemSchema,
  adminUserListResponseSchema,
  adminUserMutationHeadersSchema,
  adminUserPathSchema,
  adminUserReplayContextSchema,
  adminUserUpdateRequestSchema,
  adminUserVersionHeadersSchema,
  userDirectoryItemSchema,
  userDirectoryResponseSchema,
} from "./contracts/users.zod.js";

export interface SchemaRegistryEntry {
  readonly schema: z.ZodType;
  readonly summary: string;
  /**
   * 技术设计 4.1.1 / ADR-019：标为敏感的叶子字段路径禁止进入幂等重放策略。
   * 路径记法与 collectLeafPaths 一致（对象用 `.`，数组用 `[]`）。
   */
  readonly sensitiveFieldPaths: readonly string[];
}

/**
 * Schema Registry 是请求与响应数据结构的唯一来源（技术设计 4.1）。
 * 每个条目必须通过 `.meta({ id })` 声明与键名一致的 OpenAPI 组件名。
 */
export const schemaRegistry = {
  ...taskCompletionSchemas,
  ...moduleSchemas,
  ...featureSchemas,
  ...taskSchemas,
  ...recordDraftSchemas,
  ...publishedRecordSchemas,

  ...taskGroupSchemas,
  ErrorResponse: {
    schema: errorResponseSchema,
    summary: "统一错误响应模型",
    sensitiveFieldPaths: [],
  },
  HealthResponse: {
    schema: healthResponseSchema,
    summary: "存活探针响应",
    sensitiveFieldPaths: [],
  },
  CsrfIssueResponse: {
    schema: csrfIssueResponseSchema,
    summary: "CSRF 同步 Token 签发响应",
    sensitiveFieldPaths: ["csrfToken"],
  },
  LoginHeaders: {
    schema: loginHeadersSchema,
    summary: "登录请求头",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  LoginRequest: {
    schema: loginRequestSchema,
    summary: "登录请求体",
    sensitiveFieldPaths: ["password"],
  },
  LoginResponse: {
    schema: loginResponseSchema,
    summary: "登录成功响应，返回绑定新 Session 的 CSRF Token 与显式认证状态",
    sensitiveFieldPaths: ["csrfToken"],
  },
  MfaEnrollmentHeaders: {
    schema: mfaEnrollmentHeadersSchema,
    summary: "管理员 MFA 注册与确认请求头，要求当前 Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  StartMfaEnrollmentRequest: {
    schema: startMfaEnrollmentRequestSchema,
    summary: "开始管理员 MFA 注册请求，携带当前用户级 enrollment generation",
    sensitiveFieldPaths: [],
  },
  StartMfaEnrollmentResponse: {
    schema: startMfaEnrollmentResponseSchema,
    summary:
      "开始注册响应；Secret 与 otpauth URI 只在本次 no-store 响应出现一次",
    sensitiveFieldPaths: ["secret", "otpauthUri"],
  },
  ConfirmMfaEnrollmentRequest: {
    schema: confirmMfaEnrollmentRequestSchema,
    summary: "确认注册请求；code 为当前 TOTP 6 位验证码",
    sensitiveFieldPaths: ["code"],
  },
  ConfirmMfaEnrollmentResponse: {
    schema: confirmMfaEnrollmentResponseSchema,
    summary: "确认注册响应；恢复码只展示一次，同时轮换为完整 Session 与新 CSRF",
    sensitiveFieldPaths: ["csrfToken", "recoveryCodes[]"],
  },
  VerifyMfaHeaders: {
    schema: verifyMfaHeadersSchema,
    summary:
      "管理员 MFA 验证请求头，要求当前 MFA_CHALLENGE Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  VerifyMfaRequest: {
    schema: verifyMfaRequestSchema,
    summary: "管理员 MFA 验证请求，携带当前 6 位 TOTP 验证码",
    sensitiveFieldPaths: ["code"],
  },
  VerifyMfaResponse: {
    schema: verifyMfaResponseSchema,
    summary: "MFA 验证成功响应；Session 升级为完整态并返回新 CSRF Token",
    sensitiveFieldPaths: ["csrfToken"],
  },
  ReauthenticateAdminHeaders: {
    schema: reauthenticateAdminHeadersSchema,
    summary: "管理员重认证请求头，要求当前完整 Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ReauthenticateAdminRequest: {
    schema: reauthenticateAdminRequestSchema,
    summary: "管理员重认证请求，携带密码与当前 6 位 TOTP 验证码",
    sensitiveFieldPaths: ["password", "code"],
  },
  RotateMfaRecoveryCodesHeaders: {
    schema: rotateMfaRecoveryCodesHeadersSchema,
    summary: "恢复码轮换请求头，要求当前完整 Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  RotateMfaRecoveryCodesResponse: {
    schema: rotateMfaRecoveryCodesResponseSchema,
    summary: "恢复码轮换成功响应；新码只展示一次",
    sensitiveFieldPaths: ["recoveryCodes[]"],
  },
  ConsumeMfaRecoveryCodeHeaders: {
    schema: consumeMfaRecoveryCodeHeadersSchema,
    summary:
      "恢复码消费请求头，要求当前 RECOVERY_CHALLENGE Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ConsumeMfaRecoveryCodeRequest: {
    schema: consumeMfaRecoveryCodeRequestSchema,
    summary: "恢复码消费请求，携带当前批次未使用的 20 字符码",
    sensitiveFieldPaths: ["code"],
  },
  ConsumeMfaRecoveryCodeResponse: {
    schema: consumeMfaRecoveryCodeResponseSchema,
    summary: "恢复码消费成功响应；Session 升级为完整态并返回新 CSRF Token",
    sensitiveFieldPaths: ["csrfToken"],
  },
  ResetAdminMfaHeaders: {
    schema: resetAdminMfaHeadersSchema,
    summary: "管理员 MFA 重置请求头，要求完整管理员 Session 的同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ResetAdminMfaRequest: {
    schema: resetAdminMfaRequestSchema,
    summary: "管理员 MFA 重置请求；目标必须是另一名系统管理员且原因必填",
    sensitiveFieldPaths: [],
  },
  LogoutHeaders: {
    schema: logoutHeadersSchema,
    summary: "登出请求头；有效 Session 必须携带当前 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  SearchQueryRequest: {
    schema: searchQueryRequestSchema,
    summary:
      "全局搜索查询参数；cursor 为服务端签名的不透明字符串，limit 默认 20、最大 50",
    sensitiveFieldPaths: [],
  },
  SearchItem: {
    schema: searchItemSchema,
    summary: "搜索结果条目，entityType 为稳定判别字段",
    sensitiveFieldPaths: [],
  },
  SearchPage: {
    schema: searchPageSchema,
    summary: "全局搜索分页结果",
    sensitiveFieldPaths: [],
  },
  ActivityPath: {
    schema: activityPathSchema,
    summary: "项目动态路径参数",
    sensitiveFieldPaths: [],
  },
  ActivityQueryRequest: {
    schema: activityQueryRequestSchema,
    summary:
      "项目动态查询参数；includeAdminOnly 仅系统管理员显式开启时扩大服务端范围",
    sensitiveFieldPaths: [],
  },
  ActivityItem: {
    schema: activityItemSchema,
    summary: "项目动态白名单条目，不包含原始审计快照",
    sensitiveFieldPaths: [],
  },
  ActivityPage: {
    schema: activityPageSchema,
    summary: "项目动态分页结果",
    sensitiveFieldPaths: [],
  },
  NotificationPath: {
    schema: notificationPathSchema,
    summary: "站内通知路径参数",
    sensitiveFieldPaths: [],
  },
  NotificationQueryRequest: {
    schema: notificationQueryRequestSchema,
    summary: "当前用户通知列表查询参数",
    sensitiveFieldPaths: [],
  },
  NotificationItem: {
    schema: notificationItemSchema,
    summary: "当前用户的一条站内通知",
    sensitiveFieldPaths: [],
  },
  NotificationPage: {
    schema: notificationPageSchema,
    summary: "当前用户通知分页结果",
    sensitiveFieldPaths: [],
  },
  NotificationUnreadCountResponse: {
    schema: notificationUnreadCountResponseSchema,
    summary: "当前用户未读通知数",
    sensitiveFieldPaths: [],
  },
  NotificationReplayContext: {
    schema: notificationReplayContextSchema,
    summary: "单条通知写操作的最小重放授权上下文",
    sensitiveFieldPaths: [],
  },
  ProjectCode: {
    schema: projectCodeSchema,
    summary: "项目编码；创建后不可修改",
    sensitiveFieldPaths: [],
  },
  ProjectPath: {
    schema: projectPathSchema,
    summary: "项目详情路径参数",
    sensitiveFieldPaths: [],
  },
  ProjectItem: {
    schema: projectItemSchema,
    summary: "项目公开摘要；包含归档状态与活跃成员数",
    sensitiveFieldPaths: [],
  },
  ProjectListResponse: {
    schema: projectListResponseSchema,
    summary: "当前用户可见项目列表；系统管理员返回全部项目",
    sensitiveFieldPaths: [],
  },
  ProjectDetailResponse: {
    schema: projectDetailResponseSchema,
    summary: "当前用户可访问项目详情；无权限统一 404",
    sensitiveFieldPaths: [],
  },
  CreateProjectRequest: {
    schema: createProjectRequestSchema,
    summary:
      "创建项目请求；创建者由服务端 Session 解析，memberIds 为可选初始成员",
    sensitiveFieldPaths: [],
  },
  CreateProjectHeaders: {
    schema: createProjectHeadersSchema,
    summary: "创建项目请求头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ProjectMemberItem: {
    schema: projectMemberItemSchema,
    summary: "项目成员摘要（响应与幂等重放共享）",
    sensitiveFieldPaths: [],
  },
  ProjectMemberCollectionPath: {
    schema: projectMemberCollectionPathSchema,
    summary: "项目成员集合路径参数",
    sensitiveFieldPaths: [],
  },
  ProjectMemberPath: {
    schema: projectMemberPathSchema,
    summary: "项目成员资源路径参数",
    sensitiveFieldPaths: [],
  },
  ProjectMemberRecordItem: {
    schema: projectMemberRecordItemSchema,
    summary: "项目成员历史记录及脱敏展示字段",
    sensitiveFieldPaths: [],
  },
  ProjectMembersListResponse: {
    schema: projectMembersListResponseSchema,
    summary: "系统管理员项目成员历史列表",
    sensitiveFieldPaths: [],
  },
  AddProjectMemberRequest: {
    schema: addProjectMemberRequestSchema,
    summary: "系统管理员添加项目成员请求",
    sensitiveFieldPaths: [],
  },
  ProjectMemberMutationHeaders: {
    schema: projectMemberMutationHeadersSchema,
    summary: "成员写请求安全头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ProjectMemberUnfinishedTaskItem: {
    schema: projectMemberUnfinishedTaskItemSchema,
    summary: "成员未完成任务及改派所需版本信息",
    sensitiveFieldPaths: [],
  },
  ProjectMemberUnfinishedTasksResponse: {
    schema: projectMemberUnfinishedTasksResponseSchema,
    summary: "成员未完成任务列表",
    sensitiveFieldPaths: [],
  },
  ProjectMemberReassignmentItem: {
    schema: projectMemberReassignmentItemSchema,
    summary: "成员移除时单任务改派参数",
    sensitiveFieldPaths: [],
  },
  RemoveProjectMemberRequest: {
    schema: removeProjectMemberRequestSchema,
    summary: "系统管理员移除项目成员及可选任务改派请求",
    sensitiveFieldPaths: [],
  },
  AddProjectMemberResponse: {
    schema: addProjectMemberResponseSchema,
    summary: "添加项目成员成功响应",
    sensitiveFieldPaths: [],
  },
  RemoveProjectMemberResponse: {
    schema: removeProjectMemberResponseSchema,
    summary: "移除项目成员成功响应",
    sensitiveFieldPaths: [],
  },
  ProjectMemberReplayContext: {
    schema: projectMemberReplayContextSchema,
    summary: "成员写操作幂等重放的最小结果资源上下文",
    sensitiveFieldPaths: [],
  },
  CreateProjectResponse: {
    schema: createProjectResponseSchema,
    summary: "创建项目成功响应（200）",
    sensitiveFieldPaths: [],
  },
  CreateProjectReplayContext: {
    schema: createProjectReplayContextSchema,
    summary: "创建项目幂等重放的最小资源授权上下文",
    sensitiveFieldPaths: [],
  },
  ProjectEditRequest: {
    schema: projectEditRequestSchema,
    summary: "项目编辑请求；编码不可修改，名称与描述整笔替换",
    sensitiveFieldPaths: [],
  },
  ProjectMutationHeaders: {
    schema: projectMutationHeadersSchema,
    summary: "项目写请求安全头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ProjectVersionHeaders: {
    schema: projectVersionHeadersSchema,
    summary: "项目编辑版本头，If-Match 防止并发覆盖",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  ProjectReplayContext: {
    schema: projectReplayContextSchema,
    summary: "项目写操作幂等重放的最小结果资源上下文",
    sensitiveFieldPaths: [],
  },
  ProjectArchiveRequest: {
    schema: projectArchiveRequestSchema,
    summary: "项目归档或恢复原因；高风险操作必须显式填写",
    sensitiveFieldPaths: [],
  },
  ProjectArchivePreviewResponse: {
    schema: projectArchivePreviewResponseSchema,
    summary: "归档前未完成任务数提醒",
    sensitiveFieldPaths: [],
  },
  UserAuthState: {
    schema: userAuthStateSchema,
    summary: "用户 Session 显式认证状态",
    sensitiveFieldPaths: [],
  },
  CurrentUserResponse: {
    schema: currentUserResponseSchema,
    summary: "当前登录用户资料",
    sensitiveFieldPaths: [],
  },
  UserDirectoryItem: {
    schema: userDirectoryItemSchema,
    summary: "用户目录公开条目，用于创建项目时选择初始成员",
    sensitiveFieldPaths: [],
  },
  UserDirectoryResponse: {
    schema: userDirectoryResponseSchema,
    summary: "全部启用用户的轻量目录；响应 no-store",
    sensitiveFieldPaths: [],
  },
  AdminUserPath: {
    schema: adminUserPathSchema,
    summary: "用户管理路径参数",
    sensitiveFieldPaths: [],
  },
  AdminUserCreateRequest: {
    schema: adminUserCreateRequestSchema,
    summary: "系统管理员新增用户请求；密码在请求中出现但不会持久化明文",
    sensitiveFieldPaths: ["password"],
  },
  AdminUserUpdateRequest: {
    schema: adminUserUpdateRequestSchema,
    summary: "用户资料与管理员角色编辑请求",
    sensitiveFieldPaths: [],
  },
  AdminUserMutationHeaders: {
    schema: adminUserMutationHeadersSchema,
    summary: "用户管理创建请求头，要求同步 CSRF Token",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  AdminUserVersionHeaders: {
    schema: adminUserVersionHeadersSchema,
    summary: "用户管理版本写请求头，要求同步 CSRF Token 与 If-Match",
    sensitiveFieldPaths: ["x-csrf-token"],
  },
  AdminUserItem: {
    schema: adminUserItemSchema,
    summary: "管理员用户管理公开条目；不暴露密码哈希或 MFA 材料",
    sensitiveFieldPaths: [],
  },
  AdminUserListResponse: {
    schema: adminUserListResponseSchema,
    summary: "管理员用户列表；响应 no-store",
    sensitiveFieldPaths: [],
  },
  AdminUserReplayContext: {
    schema: adminUserReplayContextSchema,
    summary: "用户管理幂等重放的最小结果资源上下文",
    sensitiveFieldPaths: [],
  },
} satisfies Record<string, SchemaRegistryEntry>;

export type SchemaName = keyof typeof schemaRegistry;

export const schemaNames = Object.keys(schemaRegistry) as readonly SchemaName[];

export function isSchemaName(value: string): value is SchemaName {
  return Object.hasOwn(schemaRegistry, value);
}
