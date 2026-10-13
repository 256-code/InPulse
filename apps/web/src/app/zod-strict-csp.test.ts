import { describe, expect, it } from "vitest";

// 导入顺序即生产顺序：先写入 jitless 配置（main.tsx 的首个 import），再加载 zod。
import "./zod-strict-csp";
import { z } from "zod";

describe("zod-strict-csp", () => {
  it("在 zod 加载后 jitless 配置已生效", () => {
    expect(z.core.globalConfig.jitless).toBe(true);
  });

  it("jitless 下对象 Schema 构造与解析不调用 Function 编译快路径", () => {
    const originalFunction = globalThis.Function;
    let constructorCalls = 0;
    globalThis.Function = new Proxy(originalFunction, {
      construct(target, args, newTarget) {
        constructorCalls += 1;
        return Reflect.construct(target, args, newTarget);
      },
    }) as FunctionConstructor;
    try {
      const schema = z.object({ name: z.string().min(1) });
      expect(schema.safeParse({ name: "ok" }).success).toBe(true);
      expect(schema.safeParse({ name: "" }).success).toBe(false);
    } finally {
      globalThis.Function = originalFunction;
    }
    // 严格 CSP 下 zod 的 `Function("")` 探测与 `new Function(...)` 代码生成都不再发生。
    expect(constructorCalls).toBe(0);
  });
});
