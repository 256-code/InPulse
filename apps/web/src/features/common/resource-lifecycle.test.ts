import { describe, expect, it } from "vitest";
import {
  resourceLifecycleKind,
  resourceLifecycleLabel,
  resourceLifecycleTone,
} from "./resource-lifecycle";

describe("项目与模块生命周期标签", () => {
  it("已归档优先：无论是否完成过任务都归入最后一档", () => {
    expect(resourceLifecycleKind("ARCHIVED", 0)).toBe("ARCHIVED");
    expect(resourceLifecycleKind("ARCHIVED", 9)).toBe("ARCHIVED");
    expect(resourceLifecycleLabel("ARCHIVED", 9)).toBe("已归档");
    expect(resourceLifecycleTone("ARCHIVED", 9, "blue")).toBe("amber");
  });

  it("活跃且没有任何已完成任务是未开始，用青色与正常区分", () => {
    expect(resourceLifecycleKind("ACTIVE", 0)).toBe("NOT_STARTED");
    expect(resourceLifecycleLabel("ACTIVE", 0)).toBe("未开始");
    expect(resourceLifecycleTone("ACTIVE", 0, "gray")).toBe("cyan");
    expect(resourceLifecycleTone("ACTIVE", 0, "blue")).toBe("cyan");
  });

  it("活跃且已有完成任务是正常，沿用调用方传入的主色", () => {
    expect(resourceLifecycleKind("ACTIVE", 1)).toBe("ACTIVE");
    expect(resourceLifecycleLabel("ACTIVE", 1)).toBe("正常");
    expect(resourceLifecycleTone("ACTIVE", 1, "gray")).toBe("gray");
    expect(resourceLifecycleTone("ACTIVE", 1, "blue")).toBe("blue");
  });
});
