import { describe, expect, it } from "vitest";
import { assertModuleTransition } from "../src/modules/modules/modules-management.service.js";

describe("module command version guard", () => {
  it("rejects stale edits and accepts the current version", () => {
    // ADR-044：模块层面已下线归档，模块状态不再是冲突来源，只保留版本门禁。
    expect(() => assertModuleTransition({ rowVersion: 2 }, 1)).toThrow("版本");
    expect(() => assertModuleTransition({ rowVersion: 2 }, 2)).not.toThrow();
  });
});
