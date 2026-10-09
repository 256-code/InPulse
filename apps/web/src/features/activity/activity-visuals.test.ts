import { describe, expect, it } from "vitest";
import { activityEntityIcon, activityVisualKind } from "./activity-visuals";

describe("activity-visuals 动作类别映射（方案 B 的颜色轴）", () => {
  it("创建 / 发布类动作归入 create，更新类动作归入 update", () => {
    expect(activityVisualKind("PROJECT_CREATED")).toBe("create");
    expect(activityVisualKind("module.create")).toBe("create");
    expect(activityVisualKind("record.publish")).toBe("create");
    expect(activityVisualKind("PROJECT_UPDATED")).toBe("update");
    expect(activityVisualKind("feature.update")).toBe("update");
    expect(activityVisualKind("TASK_ASSIGNED")).toBe("update");
  });

  it("删除类动作归入 delete", () => {
    expect(activityVisualKind("PROJECT_DELETED")).toBe("delete");
    expect(activityVisualKind("MODULE_DELETED")).toBe("delete");
    expect(activityVisualKind("FEATURE_DELETED")).toBe("delete");
    expect(activityVisualKind("TASK_DELETED")).toBe("delete");
  });

  it("生命周期动作归入 status；未收录取值退回 other", () => {
    expect(activityVisualKind("task.complete")).toBe("status");
    expect(activityVisualKind("task.merge")).toBe("status");
    expect(activityVisualKind("CHANGE_RECORD_VOIDED")).toBe("status");
    expect(activityVisualKind("future.unknown")).toBe("other");
  });

  it("添加/加入类归 create，移除/解除类归 delete，变更角色归 update", () => {
    expect(activityVisualKind("EXTERNAL_LINK_ADDED")).toBe("create");
    expect(activityVisualKind("PROJECT_MEMBER_ADDED")).toBe("create");
    expect(activityVisualKind("PROJECT_JOINED")).toBe("create");
    expect(activityVisualKind("EXTERNAL_LINK_REMOVED")).toBe("delete");
    expect(activityVisualKind("PROJECT_MEMBER_REMOVED")).toBe("delete");
    expect(activityVisualKind("PROJECT_MEMBER_ROLE_CHANGED")).toBe("update");
  });
});

describe("activity-visuals 对象图标映射（方案 B 的形状轴）", () => {
  it("对象类型映射到稳定的图标形状", () => {
    expect(activityEntityIcon("PROJECT")).toBe("folder");
    expect(activityEntityIcon("MODULE")).toBe("layers");
    expect(activityEntityIcon("FEATURE")).toBe("kanban");
    expect(activityEntityIcon("TASK")).toBe("boxes");
    expect(activityEntityIcon("CHANGE_RECORD")).toBe("fileText");
    expect(activityEntityIcon("LEFTOVER_ITEM")).toBe("alert");
  });

  it("未收录对象类型退回通用 activity 图标", () => {
    expect(activityEntityIcon("UNKNOWN")).toBe("activity");
  });
});
