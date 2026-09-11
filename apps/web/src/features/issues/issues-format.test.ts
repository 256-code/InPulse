import { describe, expect, it } from "vitest";
import type { LeftoverListItem } from "@generated/api";
import {
  formatIssueDate,
  isLeftoverClosed,
  issueOriginText,
} from "./issues-format";

const base: LeftoverListItem = {
  leftoverItemId: 8,
  recordId: 7,
  recordCode: "CR-201",
  recordTitle: "充电策略支持参数配置",
  projectId: 1,
  projectName: "AGV 智能搬运平台",
  moduleId: 2,
  moduleName: "任务调度",
  featureId: null,
  featureName: null,
  author: { userId: 3, name: "陈晓", avatarUrl: null },
  publishedAt: "2026-08-18T03:00:00.000Z",
  content: "高峰期多车同时等待充电的调度策略仍需优化。",
  status: "ACTIVE",
  sourceTask: null,
  followupTask: null,
};

describe("issues-format", () => {
  it("formats the origin without the feature segment when absent", () => {
    expect(issueOriginText(base)).toBe(
      "来自「充电策略支持参数配置」 · AGV 智能搬运平台 / 任务调度 · 陈晓 · 2026-08-18",
    );
    expect(
      issueOriginText({
        ...base,
        featureName: "充电任务编排",
      }),
    ).toContain("AGV 智能搬运平台 / 任务调度 / 充电任务编排");
  });

  it("keeps the raw value when the date cannot be parsed", () => {
    expect(formatIssueDate("2026-08-18T03:00:00.000Z")).toBe("2026-08-18");
    expect(formatIssueDate("不是日期")).toBe("不是日期");
  });

  it("treats converted and resolved items as closed", () => {
    expect(isLeftoverClosed(base)).toBe(false);
    expect(isLeftoverClosed({ ...base, status: "CONVERTED" })).toBe(true);
    expect(isLeftoverClosed({ ...base, status: "RESOLVED" })).toBe(true);
  });
});
