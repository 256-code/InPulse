import { firstValueFrom, of } from "rxjs";
import { describe, expect, test } from "vitest";

import { CONTRACT_OPERATION_METADATA } from "../src/http/contract.decorators.js";
import { ContractResponseError } from "../src/http/contract-errors.js";
import { ContractResponseInterceptor } from "../src/http/contract-response.interceptor.js";

function contextFor(
  handler: () => void,
  statusCode = 200,
): {
  readonly context: Parameters<ContractResponseInterceptor["intercept"]>[0];
} {
  return {
    context: {
      getHandler: () => handler,
      switchToHttp: () => ({
        getResponse: () => ({ statusCode }),
      }),
    } as never,
  };
}

describe("ContractResponseInterceptor", () => {
  test("校验响应并剔除未知字段", async () => {
    const handler = () => {};
    Reflect.defineMetadata(CONTRACT_OPERATION_METADATA, "getHealth", handler);
    const next = { handle: () => of({ status: "ok", internal: "secret" }) };
    const { context } = contextFor(handler, 200);

    const result = await firstValueFrom(
      new ContractResponseInterceptor().intercept(context, next as never),
    );
    expect(result).toEqual({ status: "ok" });
  });

  test("响应不符合 Schema 时抛出 ContractResponseError", async () => {
    const handler = () => {};
    Reflect.defineMetadata(CONTRACT_OPERATION_METADATA, "getHealth", handler);
    const next = { handle: () => of({ status: "unexpected" }) };
    const { context } = contextFor(handler, 200);

    await expect(
      firstValueFrom(
        new ContractResponseInterceptor().intercept(context, next as never),
      ),
    ).rejects.toBeInstanceOf(ContractResponseError);
  });

  test("没有 Operation 元数据时不做响应契约校验", async () => {
    const handler = () => {};
    const next = { handle: () => of({ arbitrary: true }) };
    const { context } = contextFor(handler, 200);

    await expect(
      firstValueFrom(
        new ContractResponseInterceptor().intercept(context, next as never),
      ),
    ).resolves.toEqual({ arbitrary: true });
  });
});
