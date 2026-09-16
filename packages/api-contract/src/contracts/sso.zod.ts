import { z } from "zod";

/** 单点登录发起参数上限；returnTo 只接受站内相对路径，服务端仍会二次校验。 */
export const SSO_RETURN_TO_MAX_LENGTH = 2000;
export const SSO_STATE_MAX_LENGTH = 256;
export const SSO_CODE_MAX_LENGTH = 2048;

/**
 * 单点登录发起查询参数（ADR-032）。`returnTo` 只是浏览器回跳提示，
 * 服务端必须校验为站内相对路径后才允许写入 state，禁止用于开放重定向。
 */
export const ssoStartQueryRequestSchema = z
  .object({
    returnTo: z.string().min(1).max(SSO_RETURN_TO_MAX_LENGTH).optional(),
  })
  .strict()
  .meta({ id: "SsoStartQueryRequest" });

export type SsoStartQueryRequest = z.infer<typeof ssoStartQueryRequestSchema>;

/**
 * 单点登录回调查询参数（ADR-032）。字段与 OIDC Authorization Response 精确对应：
 * 成功时携带 code/state，失败时携带 error/error_description；全部字段都是外部输入，
 * 服务端必须逐项校验（state 与 Cookie 绑定并一次性消费），不得直接信任其内容。
 */
export const ssoCallbackQueryRequestSchema = z
  .object({
    code: z.string().min(1).max(SSO_CODE_MAX_LENGTH).optional(),
    state: z.string().min(1).max(SSO_STATE_MAX_LENGTH).optional(),
    error: z.string().min(1).max(200).optional(),
    error_description: z.string().min(1).max(1000).optional(),
  })
  .strict()
  .meta({ id: "SsoCallbackQueryRequest" });

export type SsoCallbackQueryRequest = z.infer<
  typeof ssoCallbackQueryRequestSchema
>;
