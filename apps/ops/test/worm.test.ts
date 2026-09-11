import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { WormCredentials } from "../src/config.js";
import { sha256Hex } from "../src/crypto.js";
import { WormClient } from "../src/worm.js";

function credentials(
  overrides: Partial<WormCredentials> = {},
): WormCredentials {
  return {
    endpoint: new URL("https://s3.example.com"),
    region: "cn-north-1",
    bucket: "audit-worm",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: "secret",
    prefix: "inpulse/audit",
    forcePathStyle: true,
    objectLock: null,
    ...overrides,
  };
}

interface Captured {
  readonly url: URL;
  readonly init: RequestInit;
}

function captureFetch(
  responses: readonly (() => Response | Promise<Response>)[],
  captured: Captured[],
): typeof fetch {
  let index = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: input instanceof URL ? input : new URL(String(input)),
      init: init ?? {},
    });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next === undefined) {
      throw new Error("no response scripted");
    }
    return next();
  }) as typeof fetch;
}

describe("WORM S3 客户端", () => {
  test("path-style PUT：URL、签名头与对象锁头", async () => {
    const captured: Captured[] = [];
    const client = new WormClient(
      credentials({
        objectLock: { mode: "COMPLIANCE", retainDays: 30 },
      }),
      {
        fetchImpl: captureFetch(
          [() => new Response(null, { status: 200 })],
          captured,
        ),
        now: () => new Date("2026-09-11T12:00:00.000Z"),
      },
    );
    const body = Buffer.from(`{"a":1}\n`, "utf8");
    const result = await client.putObject(
      "inpulse/audit/checkpoints/chain=SYSTEM/2026-09-11T12:00:00Z-seq3.json",
      body,
      "application/json",
    );

    expect(result).toEqual({
      key: "inpulse/audit/checkpoints/chain=SYSTEM/2026-09-11T12:00:00Z-seq3.json",
      created: true,
      status: 200,
    });
    const request = captured[0];
    expect(request?.url.pathname).toBe(
      "/audit-worm/inpulse/audit/checkpoints/chain%3DSYSTEM/2026-09-11T12%3A00%3A00Z-seq3.json",
    );
    const headers = request?.init.headers as Record<string, string>;
    expect(headers["authorization"]).toContain("AWS4-HMAC-SHA256");
    expect(headers["authorization"]).toContain("cn-north-1/s3/aws4_request");
    expect(headers["x-amz-content-sha256"]).toBe(sha256Hex(body));
    expect(headers["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    expect(headers["x-amz-object-lock-retain-until-date"]).toBe(
      new Date("2026-09-11T12:00:00.000Z").getTime() + 30 * 86_400_000 ===
        new Date(headers["x-amz-object-lock-retain-until-date"] ?? 0).getTime()
        ? headers["x-amz-object-lock-retain-until-date"]
        : "",
    );
  });

  test("virtual-host 模式构造 bucket 子域 URL", async () => {
    const captured: Captured[] = [];
    const client = new WormClient(credentials({ forcePathStyle: false }), {
      fetchImpl: captureFetch(
        [() => new Response(null, { status: 200 })],
        captured,
      ),
    });
    await client.putObject("a/b.json", Buffer.from("{}"), "application/json");
    expect(captured[0]?.url.host).toBe("audit-worm.s3.example.com");
    expect(captured[0]?.url.pathname).toBe("/a/b.json");
  });

  test("409/412 视为已存在的幂等成功", async () => {
    const captured: Captured[] = [];
    for (const status of [409, 412]) {
      const client = new WormClient(credentials(), {
        fetchImpl: captureFetch(
          [() => new Response(null, { status })],
          captured,
        ),
      });
      const result = await client.putObject(
        "k.json",
        Buffer.from("{}"),
        "application/json",
      );
      expect(result.created).toBe(false);
      expect(result.status).toBe(status);
    }
  });

  test("5xx 指数退避重试，4xx 不重试", async () => {
    const captured: Captured[] = [];
    const sleeps: number[] = [];
    const flaky = new WormClient(credentials(), {
      fetchImpl: captureFetch(
        [
          () => new Response(null, { status: 500 }),
          () => new Response(null, { status: 503 }),
          () => new Response(null, { status: 200 }),
        ],
        captured,
      ),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await flaky.putObject(
      "k.json",
      Buffer.from("{}"),
      "application/json",
    );
    expect(result.created).toBe(true);
    expect(sleeps).toEqual([500, 1000]);

    const forbidden = new WormClient(credentials(), {
      fetchImpl: captureFetch(
        [() => new Response(null, { status: 403 })],
        captured,
      ),
    });
    await expect(
      forbidden.putObject("k.json", Buffer.from("{}"), "application/json"),
    ).rejects.toThrow("403");
  });

  test("getObject 返回内容，404 抛错", async () => {
    const body = randomBytes(16);
    const captured: Captured[] = [];
    const client = new WormClient(credentials(), {
      fetchImpl: captureFetch(
        [
          () => new Response(body, { status: 200 }),
          () => new Response(null, { status: 404 }),
        ],
        captured,
      ),
    });
    const fetched = await client.getObject("a.json");
    expect(fetched.equals(body)).toBe(true);
    await expect(client.getObject("missing.json")).rejects.toThrow("not found");
  });
});
