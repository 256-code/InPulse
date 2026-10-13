import { describe, expect, test, vi } from "vitest";

import {
  AiAssistProbeError,
  probeAiAssistUpstream,
  resolveAiAssistCheckOptions,
  type AiAssistCheckOptions,
} from "../src/ai-assist-check-cli.js";

const baseOptions: AiAssistCheckOptions = {
  endpoint: "https://relay.example.com/v1/chat/completions",
  model: "gpt-test",
  keyFile: "/run/secrets/ai_assist_api_key",
  timeoutMs: 60_000,
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

describe("AI 辅助自检参数解析", () => {
  test("命令行参数优先于环境变量并做端点 / 超时校验", () => {
    const options = resolveAiAssistCheckOptions(
      [
        "--endpoint",
        "https://relay.example.com/v1/chat/completions",
        "--timeout-ms",
        "5000",
      ],
      {
        AI_ASSIST_ENDPOINT: "https://ignored.example.com",
        AI_ASSIST_MODEL: "env-model",
        AI_ASSIST_API_KEY_FILE: "/run/secrets/ai_assist_api_key",
      },
    );
    expect(options.endpoint).toBe(
      "https://relay.example.com/v1/chat/completions",
    );
    expect(options.model).toBe("env-model");
    expect(options.timeoutMs).toBe(5000);
  });

  test("缺失端点 / 模型 / 密钥文件时报用法错误", () => {
    expect(() => resolveAiAssistCheckOptions([], {})).toThrow(
      "endpoint is required",
    );
    expect(() =>
      resolveAiAssistCheckOptions([], {
        AI_ASSIST_ENDPOINT: "https://relay.example.com/v1/chat/completions",
      }),
    ).toThrow("model is required");
    expect(() =>
      resolveAiAssistCheckOptions([], {
        AI_ASSIST_ENDPOINT: "https://relay.example.com/v1/chat/completions",
        AI_ASSIST_MODEL: "gpt-test",
      }),
    ).toThrow("key file is required");
  });

  test("生产只接受 https 端点；回环 http 只限非生产", () => {
    expect(() =>
      resolveAiAssistCheckOptions([], {
        NODE_ENV: "production",
        AI_ASSIST_ENDPOINT: "http://127.0.0.1:3199/v1/chat/completions",
        AI_ASSIST_MODEL: "gpt-test",
        AI_ASSIST_API_KEY_FILE: "/run/secrets/ai_assist_api_key",
      }),
    ).toThrow("https");
    const options = resolveAiAssistCheckOptions([], {
      NODE_ENV: "test",
      AI_ASSIST_ENDPOINT: "http://127.0.0.1:3199/v1/chat/completions",
      AI_ASSIST_MODEL: "gpt-test",
      AI_ASSIST_API_KEY_FILE: "/tmp/api-key",
    });
    expect(options.endpoint).toBe("http://127.0.0.1:3199/v1/chat/completions");
    const nonLoopback = {
      ...baseOptions,
      endpoint: "http://relay.example.com/v1/chat/completions",
    };
    expect(() =>
      resolveAiAssistCheckOptions(
        [
          "--endpoint",
          nonLoopback.endpoint,
          "--model",
          "gpt-test",
          "--key-file",
          "/run/secrets/k",
        ],
        {},
      ),
    ).toThrow("https");
  });

  test("超时必须是 1000~600000 的整数", () => {
    const args = [
      "--endpoint",
      "https://relay.example.com/v1/chat/completions",
      "--model",
      "gpt-test",
      "--key-file",
      "/run/secrets/k",
    ];
    expect(() =>
      resolveAiAssistCheckOptions([...args, "--timeout-ms", "999"], {}),
    ).toThrow("timeout-ms");
    expect(() =>
      resolveAiAssistCheckOptions([...args, "--timeout-ms", "abc"], {}),
    ).toThrow("timeout-ms");
    expect(
      resolveAiAssistCheckOptions([...args, "--timeout-ms", "600000"], {})
        .timeoutMs,
    ).toBe(600000);
  });
});

describe("AI 辅助上游探测", () => {
  test("成功响应返回模型与内容长度，请求为最小形状", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse(200, {
        model: "gpt-stub",
        choices: [{ message: { content: "ok" }, finish_reason: "length" }],
      });
    });
    const result = await probeAiAssistUpstream(
      baseOptions,
      "secret-key",
      fetchImpl as unknown as typeof fetch,
    );
    expect(result).toEqual({ model: "gpt-stub", contentChars: 2 });
    const [recorded] = calls;
    expect(recorded?.url).toBe(baseOptions.endpoint);
    const body = JSON.parse(String(recorded?.init.body)) as Record<
      string,
      unknown
    >;
    expect(body["max_tokens"]).toBe(1);
    expect(body["temperature"]).toBe(0);
    expect(body["stream"]).toBe(false);
    expect(body["model"]).toBe(baseOptions.model);
    expect(body["messages"]).toEqual([{ role: "user", content: "ping" }]);
    expect(
      (recorded?.init.headers as Record<string, string>)["authorization"],
    ).toBe("Bearer secret-key");
  });

  test("401 / 403 归类为 auth，429 归类为 rate-limited", async () => {
    const unauthorized = vi.fn(async () =>
      jsonResponse(401, { error: "nope" }),
    );
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "bad-key",
        unauthorized as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "auth" });
    const limited = vi.fn(async () =>
      jsonResponse(429, { error: "slow down" }),
    );
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "key",
        limited as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "rate-limited" });
  });

  test("响应形状不符合适配器预期时报 invalid-response", async () => {
    const noContent = vi.fn(async () =>
      jsonResponse(200, { choices: [{ message: {} }] }),
    );
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "key",
        noContent as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(AiAssistProbeError);
    const notJson = vi.fn(
      async () => new Response("<html>gateway</html>", { status: 200 }),
    );
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "key",
        notJson as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
    const serverError = vi.fn(async () => jsonResponse(500, {}));
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "key",
        serverError as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });

  test("网络异常归类为 network", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      probeAiAssistUpstream(
        baseOptions,
        "key",
        failing as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ reason: "network" });
  });
});
