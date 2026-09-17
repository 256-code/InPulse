import { describe, expect, it } from "vitest";
import {
  projectLifecycleKind,
  projectLifecycleLabel,
  projectLifecycleTone,
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

  it("活跃且没有任何已完成任务是未开始，用青色与进行中区分", () => {
    expect(resourceLifecycleKind("ACTIVE", 0)).toBe("NOT_STARTED");
    expect(resourceLifecycleLabel("ACTIVE", 0)).toBe("未开始");
    expect(resourceLifecycleTone("ACTIVE", 0, "gray")).toBe("cyan");
    expect(resourceLifecycleTone("ACTIVE", 0, "blue")).toBe("cyan");
  });

  it("活跃且已有完成任务是进行中，沿用调用方传入的主色", () => {
    expect(resourceLifecycleKind("ACTIVE", 1)).toBe("ACTIVE");
    expect(resourceLifecycleLabel("ACTIVE", 1)).toBe("进行中");
    expect(resourceLifecycleTone("ACTIVE", 1, "gray")).toBe("gray");
    expect(resourceLifecycleTone("ACTIVE", 1, "blue")).toBe("blue");
  });
});

describe("项目四态标签（ADR-035）", () => {
  it("直接映射服务端存储的状态，不再由完成任务数推导", () => {
    expect(projectLifecycleKind("NOT_STARTED")).toBe("NOT_STARTED");
    expect(projectLifecycleKind("ACTIVE")).toBe("ACTIVE");
    expect(projectLifecycleKind("MAINTENANCE")).toBe("MAINTENANCE");
    expect(projectLifecycleKind("ARCHIVED")).toBe("ARCHIVED");
  });

  it("四态各自的中文标签", () => {
    expect(projectLifecycleLabel("NOT_STARTED")).toBe("未开始");
    expect(projectLifecycleLabel("ACTIVE")).toBe("进行中");
    expect(projectLifecycleLabel("MAINTENANCE")).toBe("维护中");
    expect(projectLifecycleLabel("ARCHIVED")).toBe("已归档");
  });

  it("配色：未开始青、维护中紫、已归档琥珀，进行中沿用调用方主色", () => {
    expect(projectLifecycleTone("NOT_STARTED", "blue")).toBe("cyan");
    expect(projectLifecycleTone("MAINTENANCE", "blue")).toBe("violet");
    expect(projectLifecycleTone("ARCHIVED", "blue")).toBe("amber");
    expect(projectLifecycleTone("ACTIVE", "blue")).toBe("blue");
  });
});
