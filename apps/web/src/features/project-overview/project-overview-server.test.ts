import { describe, expect, it, vi } from "vitest";
import type { InpulseApiClient, ProjectOverviewResponse } from "@generated/api";
import {
  createProjectOverviewServerAdapter,
  PROJECT_OVERVIEW_SERVER_NOTICE,
} from "./project-overview-server";

const response: ProjectOverviewResponse = {
  project: { projectId: 1, name: "InPulse 平台", status: "ACTIVE" },
  memberCount: 3,
  stats: {
    activeModuleCount: 1,
    activeFeatureCount: 2,
    openTaskCount: 3,
    publishedRecordCount: 4,
  },
  recentRecords: [
    {
      recordId: 12,
      code: "CR-201",
      title: "增加商户订单号幂等校验",
      moduleId: 3,
      featureId: 9,
      featureName: "微信支付退款回调",
      publishedAt: "2026-09-10T09:00:00.000Z",
    },
  ],
  activeLeftovers: [
    {
      leftoverItemId: 21,
      recordId: 12,
      recordCode: "CR-201",
      content: "补齐恢复码入口",
      createdAt: "2026-09-10T09:30:00.000Z",
    },
  ],
};

describe("project overview server adapter", () => {
  it("calls the generated client with the frozen default query", async () => {
    const getProjectOverview = vi.fn().mockResolvedValue(response);
    const client = { getProjectOverview } as unknown as InpulseApiClient;
    const adapter = createProjectOverviewServerAdapter(client);

    expect(adapter.source).toBe("server");
    expect(adapter.notice).toBe(PROJECT_OVERVIEW_SERVER_NOTICE);

    const result = await adapter.fetchProjectOverview({ projectId: 1 });

    expect(getProjectOverview).toHaveBeenCalledWith(1, {
      recentRecordLimit: 3,
      activeLeftoverLimit: 2,
    });
    expect(result.stats).toEqual({
      activeModules: 1,
      activeFeatures: 2,
      openTasks: 3,
      publishedRecords: 4,
      openLeftovers: null,
    });
    expect(result.recentIterations).toEqual([
      {
        recordId: 12,
        code: "CR-201",
        title: "增加商户订单号幂等校验",
        featureName: "微信支付退款回调",
        publishedAt: "2026-09-10T09:00:00.000Z",
      },
    ]);
    expect(result.leftovers).toEqual([
      {
        leftoverId: 21,
        summary: "补齐恢复码入口",
        recordCode: "CR-201",
        recordTitle: null,
      },
    ]);
  });

  it("keeps the notice explicit about the frozen contract gaps", () => {
    expect(PROJECT_OVERVIEW_SERVER_NOTICE).toContain("遗留问题总数");
    expect(PROJECT_OVERVIEW_SERVER_NOTICE).toContain("来源记录标题");
  });
});
