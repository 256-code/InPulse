import { describe, expect, it } from "vitest";
import { ApiError } from "@generated/api";

import { projectWecomGroupErrorMessage } from "./project-wecom-group-query";

const apiError = (status: number, code: string): ApiError =>
  new ApiError(status, {
    code,
    message: "internal",
    details: {},
    requestId: "r",
  });

/**
 * 2026-10-16 实测踩坑：dev API 是旧进程、路由还没部署，框架兜底 404 的 code 是
 * NOT_FOUND，卡片却把「功能还没上线」说成「项目不存在或你已不是项目成员」，
 * 让用户以为自己的成员关系出了问题。两个 404 必须分开说。
 */
describe("projectWecomGroupErrorMessage", () => {
  it("路由未部署（框架兜底 404）时说清是后端服务没有这个功能", () => {
    expect(projectWecomGroupErrorMessage(apiError(404, "NOT_FOUND"))).toBe(
      "当前服务还没有企业微信项目群功能，请让管理员更新后端服务后重试。",
    );
  });

  it("业务 404 仍按「项目不存在或已不是成员」解释", () => {
    expect(
      projectWecomGroupErrorMessage(
        apiError(404, "PROJECT_WECOM_GROUP_NOT_FOUND"),
      ),
    ).toBe("项目不存在或你已不是项目成员。");
  });

  it("其它门的文案不受影响", () => {
    expect(projectWecomGroupErrorMessage(apiError(403, "FORBIDDEN"))).toBe(
      "只有项目组长或系统管理员可以管理企业微信项目群。",
    );
    expect(projectWecomGroupErrorMessage(new Error("boom"))).toBe(
      "企业微信项目群服务暂时不可用，请重试。",
    );
  });
});
