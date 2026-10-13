import { Logger } from "@nestjs/common";
import { DOCUMENT_IMPORT_TEMPLATE } from "@inpulse/api-contract";
import { describe, expect, test, vi } from "vitest";

import type { AiAssistConfig } from "../src/modules/document-import/ai-assist.config.js";
import { DocumentImportAiAssistClient } from "../src/modules/document-import/ai-assist.client.js";

// 静音 Nest Logger，保持测试输出干净。
vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);

const config: AiAssistConfig = {
  endpoint: "https://api.example.com/v1/chat/completions",
  model: "test-model",
  apiKey: "stub",
  timeoutMs: 5_000,
  maxTokens: 4_096,
};

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(
  respond: (call: FetchCall) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: readonly FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init: unknown) => {
    const call: FetchCall = {
      url: String(url),
      init: (init ?? {}) as RequestInit,
    };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function completion(
  content: string,
  finishReason = "stop",
  model = "returned-model",
) {
  return {
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    model,
  };
}

describe("DocumentImportAiAssistClient", () => {
  test("请求构造：OpenAI 兼容字段与 Bearer 密钥，user 只含原文", async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse(completion("## 模块：支付")),
    );
    const client = new DocumentImportAiAssistClient(fetchImpl);
    await client.generateDraft(config, {
      mode: "WHOLE_PROJECT",
      text: "我的项目文档原文",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(config.endpoint);
    expect(calls[0]!.init.method).toBe("POST");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer stub");
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      model: string;
      messages: readonly { role: string; content: string }[];
      max_tokens: number;
      temperature: number;
      stream: boolean;
    };
    expect(body.model).toBe("test-model");
    expect(body.max_tokens).toBe(4_096);
    expect(body.temperature).toBe(0.2);
    expect(body.stream).toBe(false);
    expect(body.messages[0]!.role).toBe("system");
    expect(body.messages[0]!.content).toContain(DOCUMENT_IMPORT_TEMPLATE);
    expect(body.messages[0]!.content).toContain("整项目导入");
    expect(body.messages[1]).toEqual({
      role: "user",
      content: "我的项目文档原文",
    });
  });

  test("IN_PROJECT 模式的 system 指令包含项目内导入约束", async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse(completion("## 模块：支付")),
    );
    const client = new DocumentImportAiAssistClient(fetchImpl);
    await client.generateDraft(config, { mode: "IN_PROJECT", text: "文档" });
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      messages: readonly { role: string; content: string }[];
    };
    expect(body.messages[0]!.content).toContain("项目内导入（向已有项目追加）");
  });
  test("成功响应：markdown trim 后返回，model 回显响应值", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(completion("  ## 模块：支付\n", "stop", "stub-model-v1")),
    );
    const client = new DocumentImportAiAssistClient(fetchImpl);
    const draft = await client.generateDraft(config, {
      mode: "IN_PROJECT",
      text: "文档",
    });
    expect(draft).toEqual({
      markdown: "## 模块：支付",
      model: "stub-model-v1",
      truncated: false,
    });
  });

  test("finish_reason=length 时 truncated=true", async () => {
    const { fetchImpl } = stubFetch(() =>
      jsonResponse(completion("## 模块：支付", "length")),
    );
    const client = new DocumentImportAiAssistClient(fetchImpl);
    const draft = await client.generateDraft(config, {
      mode: "IN_PROJECT",
      text: "文档",
    });
    expect(draft.truncated).toBe(true);
  });

  test("401 → auth，429 → rate-limited，400 + context 提示 → context-limit", async () => {
    const auth = stubFetch(() => jsonResponse({ error: "bad key" }, 401));
    await expect(
      new DocumentImportAiAssistClient(auth.fetchImpl).generateDraft(config, {
        mode: "IN_PROJECT",
        text: "x",
      }),
    ).rejects.toMatchObject({ reason: "auth" });
    const limited = stubFetch(() => jsonResponse({ error: "slow" }, 429));
    await expect(
      new DocumentImportAiAssistClient(limited.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "rate-limited" });
    const contextLimit = stubFetch(() =>
      jsonResponse(
        {
          error: {
            message: "This model has a maximum context length of 8192 tokens",
          },
        },
        400,
      ),
    );
    await expect(
      new DocumentImportAiAssistClient(contextLimit.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "context-limit" });
    const upstreamError = stubFetch(() => jsonResponse({}, 500));
    await expect(
      new DocumentImportAiAssistClient(upstreamError.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });

  test("超时 → timeout，普通网络异常 → network", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    const timeout = stubFetch(() => {
      throw abort;
    });
    await expect(
      new DocumentImportAiAssistClient(timeout.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "timeout" });
    const network = stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      new DocumentImportAiAssistClient(network.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "network" });
  });

  test("非 JSON / 缺少 choices / 空 content / 超长 content → invalid-response", async () => {
    const notJson = stubFetch(() => new Response("not json", { status: 200 }));
    await expect(
      new DocumentImportAiAssistClient(notJson.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
    const emptyChoices = stubFetch(() => jsonResponse({ choices: [] }));
    await expect(
      new DocumentImportAiAssistClient(emptyChoices.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
    const blank = stubFetch(() => jsonResponse(completion("   ")));
    await expect(
      new DocumentImportAiAssistClient(blank.fetchImpl).generateDraft(config, {
        mode: "IN_PROJECT",
        text: "x",
      }),
    ).rejects.toMatchObject({ reason: "invalid-response" });
    const tooLong = stubFetch(() =>
      jsonResponse(completion("x".repeat(200_001))),
    );
    await expect(
      new DocumentImportAiAssistClient(tooLong.fetchImpl).generateDraft(
        config,
        { mode: "IN_PROJECT", text: "x" },
      ),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });

  test("probe：max_tokens=1 探测请求，回显响应 model", async () => {
    const { fetchImpl, calls } = stubFetch(() =>
      jsonResponse(completion("p", "stop", "probe-model")),
    );
    const client = new DocumentImportAiAssistClient(fetchImpl);
    await expect(client.probe(config)).resolves.toEqual({
      model: "probe-model",
    });
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      max_tokens: number;
      temperature: number;
      messages: readonly { role: string; content: string }[];
    };
    expect(body.max_tokens).toBe(1);
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer stub");
  });

  test("probe：401 → auth，缺少 choices → invalid-response", async () => {
    const auth = stubFetch(() => jsonResponse({ error: "bad key" }, 401));
    await expect(
      new DocumentImportAiAssistClient(auth.fetchImpl).probe(config),
    ).rejects.toMatchObject({ reason: "auth" });
    const noChoices = stubFetch(() => jsonResponse({ choices: [] }));
    await expect(
      new DocumentImportAiAssistClient(noChoices.fetchImpl).probe(config),
    ).rejects.toMatchObject({ reason: "invalid-response" });
  });
});
