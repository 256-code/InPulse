import { describe, expect, test } from "vitest";

import { ConcurrencyGate } from "../src/auth/concurrency-gate.js";

describe("ConcurrencyGate", () => {
  test("并发任务数不超过 limit", async () => {
    const gate = new ConcurrencyGate(2);
    let active = 0;
    let peak = 0;

    const task = async (): Promise<void> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    };

    await Promise.all([gate.run(task), gate.run(task), gate.run(task)]);
    expect(peak).toBe(2);
    expect(gate.activeCount).toBe(0);
    expect(gate.waitingCount).toBe(0);
  });

  test("任务抛错时释放并发额度", async () => {
    const gate = new ConcurrencyGate(1);
    await expect(
      gate.run(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(gate.activeCount).toBe(0);
    await expect(gate.run(async () => undefined)).resolves.toBeUndefined();
  });

  test("limit 非正整数时 fail closed", () => {
    expect(() => new ConcurrencyGate(0)).toThrow();
    expect(() => new ConcurrencyGate(1.5)).toThrow();
  });
});
