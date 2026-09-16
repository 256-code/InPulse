import { describe, expect, test } from "vitest";

import { SsoController } from "../src/auth/sso/sso.controller.js";
import {
  DisabledSsoGateway,
  SsoGateway,
  type SsoCompleteInput,
  type SsoCompleteResult,
  type SsoStartInput,
  type SsoStartResult,
} from "../src/auth/sso/sso-gateway.js";

interface RecordedResponse {
  status: number;
  readonly headers: Record<string, string | readonly string[]>;
}

function createResponse(): {
  readonly recorded: RecordedResponse;
  readonly response: {
    status(code: number): unknown;
    setHeader(name: string, value: string | readonly string[]): unknown;
  };
} {
  const recorded: RecordedResponse = { status: 0, headers: {} };
  return {
    recorded,
    response: {
      status: (code) => {
        recorded.status = code;
        return recorded;
      },
      setHeader: (name, value) => {
        recorded.headers[name] = value;
        return recorded;
      },
    },
  };
}

function headers(recorded: RecordedResponse): readonly string[] {
  const value = recorded.headers["Set-Cookie"];
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value as string];
}

class StubGateway extends SsoGateway {
  readonly enabled: boolean;
  constructor(
    enabled: boolean,
    private readonly startResult: SsoStartResult,
    private readonly completeResult: SsoCompleteResult,
    private readonly fail = false,
  ) {
    super();
    this.enabled = enabled;
  }

  start(_input: SsoStartInput): Promise<SsoStartResult> {
    return this.fail
      ? Promise.reject(new Error("boom"))
      : Promise.resolve(this.startResult);
  }

  complete(_input: SsoCompleteInput): Promise<SsoCompleteResult> {
    return this.fail
      ? Promise.reject(new Error("boom"))
      : Promise.resolve(this.completeResult);
  }
}

const request = { headers: {}, ip: "203.0.113.9" };

describe("SsoController（ADR-032 302 语义）", () => {
  test("未启用 SSO 时回落到本地入口并保留站内回跳目标", async () => {
    const controller = new SsoController(new DisabledSsoGateway());
    const { recorded, response } = createResponse();

    await controller.start({ ...request }, response, {
      returnTo: "/projects/7?tab=1",
    });

    expect(recorded.status).toBe(302);
    expect(recorded.headers["Location"]).toBe(
      "/login?local=1&sso=disabled&from=%2Fprojects%2F7%3Ftab%3D1",
    );
    expect(recorded.headers["Cache-Control"]).toBe("no-store");
    expect(headers(recorded)).toHaveLength(0);
  });

  test("未启用 SSO 时丢弃非站内回跳目标", async () => {
    const controller = new SsoController(new DisabledSsoGateway());
    const { recorded, response } = createResponse();

    await controller.start({ ...request }, response, {
      returnTo: "https://evil.example.com",
    });

    expect(recorded.headers["Location"]).toBe("/login?local=1&sso=disabled");
  });

  test("start 下发 state Cookie 并 302 到授权端点", async () => {
    const controller = new SsoController(
      new StubGateway(
        true,
        {
          location:
            "https://authtest.libiaorobot.com/login/oauth/authorize?x=1",
          cookies: [
            {
              name: "__Host-sso-state",
              value: "state-value",
              maxAgeSeconds: 600,
            },
          ],
        },
        { location: "/", cookies: [] },
      ),
    );
    const { recorded, response } = createResponse();

    await controller.start({ ...request }, response, { returnTo: "/projects" });

    expect(recorded.status).toBe(302);
    expect(recorded.headers["Location"]).toBe(
      "https://authtest.libiaorobot.com/login/oauth/authorize?x=1",
    );
    expect(headers(recorded)).toEqual([
      "__Host-sso-state=state-value; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600",
    ]);
  });

  test("start 内部异常时回登录页错误态，不泄露内部原因", async () => {
    const controller = new SsoController(
      new StubGateway(
        true,
        { location: "/ignored", cookies: [] },
        { location: "/", cookies: [] },
        true,
      ),
    );
    const { recorded, response } = createResponse();

    await controller.start({ ...request }, response, {});

    expect(recorded.status).toBe(302);
    expect(recorded.headers["Location"]).toBe("/login?sso_error=internal");
    expect(headers(recorded)).toHaveLength(0);
  });

  test("callback 成功时下发 Session 并清理 state Cookie", async () => {
    const controller = new SsoController(
      new StubGateway(
        true,
        { location: "/ignored", cookies: [] },
        {
          location: "/projects",
          cookies: [
            { name: "__Host-sso-state", value: null, maxAgeSeconds: 0 },
            {
              name: "__Host-session",
              value: "session-value",
              maxAgeSeconds: 604800,
            },
          ],
        },
      ),
    );
    const { recorded, response } = createResponse();

    await controller.callback({ ...request }, response, {
      code: "code-1",
      state: "state-1",
    });

    expect(recorded.status).toBe(302);
    expect(recorded.headers["Location"]).toBe("/projects");
    expect(headers(recorded)).toEqual([
      "__Host-sso-state=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      "__Host-session=session-value; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800",
    ]);
  });

  test("callback 失败时回登录页错误态", async () => {
    const controller = new SsoController(
      new StubGateway(
        true,
        { location: "/ignored", cookies: [] },
        { location: "/", cookies: [] },
        true,
      ),
    );
    const { recorded, response } = createResponse();

    await controller.callback({ ...request }, response, {
      error: "access_denied",
    });

    expect(recorded.headers["Location"]).toBe("/login?sso_error=internal");
  });
});
