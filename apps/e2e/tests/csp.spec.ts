import { expect, test, type Page } from "@playwright/test";

import { loginViaUi } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

// 技术设计 v1.2.2 §7.5 的权威策略串（ADR-021）；测试内独立声明，验证实际下发值。
const EXPECTED_POLICY_TEMPLATE =
  "default-src 'self'; script-src 'self' 'nonce-{NONCE}'; script-src-attr 'none'; " +
  "style-src 'self' 'nonce-{NONCE}'; style-src-attr 'none'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; " +
  "base-uri 'none'; object-src 'none'; form-action 'self'";

// appTheme.colorPrimary (#1467d8) 的 computed 值，用于证明 cssinjs 运行时样式在
// 强制 CSP 下确实生效（未被 nonce 策略拦截）。
const PRIMARY_BUTTON_BACKGROUND = "rgb(20, 103, 216)";

interface CspViolation {
  readonly directive: string;
  readonly blockedUri: string;
}

function policyNonce(
  policy: string,
  directive: "script-src" | "style-src",
): string {
  const match = new RegExp(
    `${directive} 'self' 'nonce-([A-Za-z0-9+/=_-]+)'`,
  ).exec(policy);
  expect(
    match,
    `${directive} nonce missing in policy: ${policy}`,
  ).not.toBeNull();
  return match?.[1] ?? "";
}

async function readMetaNonce(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const meta = document.querySelector('meta[property="csp-nonce"]');
    return meta instanceof HTMLMetaElement ? meta.nonce || null : null;
  });
}

test("HTML 入口为每个响应签发与 CSP 头一致的脚本/样式 nonce", async ({
  page,
}) => {
  const first = await page.goto("/login");
  expect(first?.status()).toBe(200);

  const policy = first?.headers()["content-security-policy"] ?? "";
  const scriptNonce = policyNonce(policy, "script-src");
  const styleNonce = policyNonce(policy, "style-src");
  expect(styleNonce).toBe(scriptNonce);
  expect(policy).toBe(
    EXPECTED_POLICY_TEMPLATE.replaceAll("{NONCE}", scriptNonce),
  );
  expect(policy).not.toContain("unsafe-inline");

  const headers = first?.headers() ?? {};
  expect(headers["cache-control"] ?? "").toContain("no-store");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["permissions-policy"]).toContain("camera=()");

  const html = (await first?.text()) ?? "";
  expect(html).not.toContain("__INPULSE_CSP_NONCE__");
  expect(await readMetaNonce(page)).toBe(scriptNonce);

  const scriptNonces = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script[src]")).map((element) =>
      element instanceof HTMLScriptElement ? element.nonce : "",
    ),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((value) => value === scriptNonce)).toBe(true);

  const second = await page.goto("/login");
  const secondPolicy = second?.headers()["content-security-policy"] ?? "";
  const secondNonce = policyNonce(secondPolicy, "script-src");
  expect(secondNonce).not.toBe(scriptNonce);
  expect(await readMetaNonce(page)).toBe(secondNonce);
});

test("强制 CSP 下登录、主题、弹层、懒加载与错误页均无违规", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  await context.addInitScript(() => {
    const violations: CspViolation[] = [];
    (window as unknown as { __cspViolations: CspViolation[] }).__cspViolations =
      violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.violatedDirective,
        blockedUri: event.blockedURI,
      });
    });
  });
  const page = await context.newPage();

  // 登录表单 + 主题
  await loginViaUi(page, runtime);
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();

  const primaryBackground = await page.evaluate(() => {
    const button = document.querySelector(
      '[data-testid="create-project-button"]',
    );
    return button ? getComputedStyle(button).backgroundColor : "";
  });
  expect(primaryBackground).toBe(PRIMARY_BUTTON_BACKGROUND);

  // 弹层：命令面板（含懒加载搜索）与通知中心
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "全局搜索" });
  await expect(palette).toBeVisible();
  await palette.getByLabel("全局搜索关键词").fill("E2E");
  await page.keyboard.press("Escape");
  await expect(palette).toBeHidden();

  await page.getByRole("button", { name: "通知" }).click();
  await expect(page.getByRole("dialog", { name: "通知中心" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "通知中心" })).toBeHidden();

  // 懒加载路由：活动入口页
  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();

  // 错误页：真实 404 文案由前端错误态渲染
  await page.goto("/projects/999999999/activity");
  await expect(page.getByText(/项目不存在或你无权访问/)).toBeVisible();

  const violations = await page.evaluate(
    () =>
      (window as unknown as { __cspViolations?: CspViolation[] })
        .__cspViolations ?? [],
  );
  expect(violations, JSON.stringify(violations)).toEqual([]);

  await context.close();
});
