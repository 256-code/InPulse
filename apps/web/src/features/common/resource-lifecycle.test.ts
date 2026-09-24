import { describe, expect, it } from "vitest";
import {
  moduleLifecycleKind,
  moduleLifecycleLabel,
  moduleLifecycleTone,
  projectLifecycleKind,
  projectLifecycleLabel,
  projectLifecycleTone,
} from "./resource-lifecycle";

describe("模块生命周期标签（ADR-044）", () => {
  it("没有已完成任务是未开始，用青色与进行中区分", () => {
    expect(moduleLifecycleKind(0)).toBe("NOT_STARTED");
    expect(moduleLifecycleLabel(0)).toBe("未开始");
    expect(moduleLifecycleTone(0, "gray")).toBe("cyan");
    expect(moduleLifecycleTone(0, "blue")).toBe("cyan");
  });

  it("已有完成任务是进行中，沿用调用方传入的主色", () => {
    expect(moduleLifecycleKind(1)).toBe("ACTIVE");
    expect(moduleLifecycleLabel(1)).toBe("进行中");
    expect(moduleLifecycleTone(1, "gray")).toBe("gray");
    expect(moduleLifecycleTone(1, "blue")).toBe("blue");
  });

  it("模块已无归档档位：任何完成任务数都不会得到「已归档」", () => {
    for (const count of [0, 1, 9])
      expect(moduleLifecycleLabel(count)).not.toBe("已归档");
  });
});

describe("项目三态标签（ADR-043）", () => {
  it("直接映射服务端存储的状态，不再由完成任务数推导，且不再有归档档位", () => {
    expect(projectLifecycleKind("NOT_STARTED")).toBe("NOT_STARTED");
    expect(projectLifecycleKind("ACTIVE")).toBe("ACTIVE");
    expect(projectLifecycleKind("MAINTENANCE")).toBe("MAINTENANCE");
  });

  it("三态各自的中文标签", () => {
    expect(projectLifecycleLabel("NOT_STARTED")).toBe("未开始");
    expect(projectLifecycleLabel("ACTIVE")).toBe("进行中");
    expect(projectLifecycleLabel("MAINTENANCE")).toBe("维护中");
  });

  it("配色：未开始青、维护中紫，进行中沿用调用方主色", () => {
    expect(projectLifecycleTone("NOT_STARTED", "blue")).toBe("cyan");
    expect(projectLifecycleTone("MAINTENANCE", "blue")).toBe("violet");
    expect(projectLifecycleTone("ACTIVE", "blue")).toBe("blue");
  });
});
