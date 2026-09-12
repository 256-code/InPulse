import { expect } from "@playwright/test";

import { resetAdminTotpReplayStep } from "../helpers/admin-totp.js";
import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import { test } from "../helpers/mfa-fixture.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("普通成员不能访问审计页", async ({ browser }) => {
  test.setTimeout(60_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto("/audit");
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByText("无权访问", { exact: true })).toBeVisible();
    await expect(
      page.getByText("此区域仅限系统管理员访问。", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("管理员重认证后读取原始审计、按动作过滤、查看快照并切换项目链", async ({
  browser,
  mfaAdmin,
}) => {
  test.setTimeout(240_000);
  const runtime = await loadRuntime();

  // 先由普通成员创建一个全新项目：其 PROJECT 链必定包含 project.create。
  // 不用管理员创建是为了避开管理员可见全部项目时的大列表渲染（本地长跑库）。
  const creator = await createAuthenticatedContext(browser, runtime);
  const project = await createProjectViaUi(creator.page, runtime, "E2EAUDIT");
  await creator.context.close();

  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  try {
    await loginAdminViaUi(page, runtime, mfaAdmin);

    // 登录只完成 MFA 挑战，尚无 5 分钟内双因子重认证：首次读取被拒并自动弹出安全验证。
    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: "动态审计" })).toBeVisible();
    const reauth = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(reauth).toBeVisible();
    await expect(
      page.getByText(
        "请先完成管理员安全验证（管理员密码 + 当前 TOTP）后再读取原始审计。",
        { exact: true },
      ),
    ).toBeVisible();

    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await reauth.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await reauth.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await reauth.getByRole("button", { name: "验证身份" }).click();
    await expect(reauth).toBeHidden();
    await expect(
      page.getByText("管理员安全验证已完成，正在重新读取原始审计。", {
        exact: true,
      }),
    ).toBeVisible();

    // 首次读取返回（有行或空态）：成功后 SYSTEM 链必然已追加 AUDIT_LOG_READ。
    const list = page.locator(".audit-list");
    const empty = page.getByText("没有匹配的审计记录", { exact: true });
    await expect(list.or(empty).first()).toBeVisible();

    // 客户端校验：操作人 ID 必须为正整数，本地拦截不发请求。
    await page.getByLabel("操作人 ID").fill("0");
    await page.getByRole("button", { name: "查询" }).click();
    await expect(
      page.getByText("操作人 ID 必须是正整数。", { exact: true }),
    ).toBeVisible();
    await page.getByLabel("操作人 ID").fill("");

    // 按动作码过滤：上一次成功读取留下的 AUDIT_LOG_READ 必然命中。
    await page.getByLabel("动作码").fill("AUDIT_LOG_READ");
    await page.getByRole("button", { name: "查询" }).click();
    const readRow = page
      .locator(".audit-row")
      .filter({ hasText: "AUDIT_LOG_READ" })
      .first();
    await expect(readRow).toBeVisible();
    await expect(readRow).toContainText("链 SYSTEM");
    await expect(readRow).toContainText("用户 #" + mfaAdmin.userId);
    await expect(readRow.getByText("用户操作", { exact: true })).toBeVisible();

    // 行内原始快照：链、动作与事件载荷（returnedCount）可见。
    await readRow.getByRole("button", { name: /查看原始快照/ }).click();
    const snapshot = page.getByRole("dialog", { name: "原始审计快照" });
    await expect(snapshot).toBeVisible();
    await expect(page.getByTestId("audit-snapshot")).toContainText(
      "AUDIT_LOG_READ",
    );
    await expect(page.getByTestId("audit-snapshot")).toContainText("SYSTEM");
    await expect(page.getByTestId("audit-snapshot-payload")).toContainText(
      "returnedCount",
    );
    await page.keyboard.press("Escape");
    await expect(snapshot).toBeHidden();

    await page.getByRole("button", { name: "重置" }).click();
    await expect(page.getByLabel("动作码")).toHaveValue("");

    // 切换项目链：project.create 只出现在对应 PROJECT 链。
    const chainSelect = page.getByLabel("审计链");
    const projectOption = chainSelect
      .locator("option")
      .filter({ hasText: project.name });
    await expect(projectOption).toHaveCount(1, { timeout: 30_000 });
    const projectId = await projectOption.getAttribute("value");
    if (projectId === null) {
      throw new Error("项目链选项缺少 value");
    }
    await chainSelect.selectOption(projectId);
    await expect(page.getByText("PROJECT:" + projectId + " 链")).toBeVisible();
    const createRow = page
      .locator(".audit-row")
      .filter({ hasText: "project.create" })
      .first();
    await expect(createRow).toBeVisible();
    await expect(createRow).toContainText("PROJECT #" + projectId);
    await page.screenshot({
      path: "test-results/f08-audit-e2e.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
