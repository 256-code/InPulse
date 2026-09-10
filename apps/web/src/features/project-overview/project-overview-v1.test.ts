import { describe, expect, it } from "vitest";
import {
  fromV1ProjectOverview,
  fromV1RecentRecords,
  isProjectOverviewV1LimitValid,
  PROJECT_OVERVIEW_V1_ACTIVE_LEFTOVER_LIMIT_DEFAULT,
  PROJECT_OVERVIEW_V1_LIMIT_MAX,
  PROJECT_OVERVIEW_V1_LIMIT_MIN,
  PROJECT_OVERVIEW_V1_MISSING_FIELDS,
  PROJECT_OVERVIEW_V1_MISSING_METRICS,
  PROJECT_OVERVIEW_V1_PATH,
  PROJECT_OVERVIEW_V1_RECENT_RECORD_LIMIT_DEFAULT,
  toProjectOverviewV1Query,
} from "./project-overview-v1";

describe("project-overview-v1", () => {
  it("keeps the frozen R-2 path and default limits", () => {
    expect(PROJECT_OVERVIEW_V1_PATH).toBe(
      "/api/v1/projects/{projectId}/overview",
    );
    expect(toProjectOverviewV1Query()).toEqual({
      recentRecordLimit: 3,
      activeLeftoverLimit: 2,
    });
    expect(PROJECT_OVERVIEW_V1_RECENT_RECORD_LIMIT_DEFAULT).toBe(3);
    expect(PROJECT_OVERVIEW_V1_ACTIVE_LEFTOVER_LIMIT_DEFAULT).toBe(2);
    expect(PROJECT_OVERVIEW_V1_LIMIT_MIN).toBe(1);
    expect(PROJECT_OVERVIEW_V1_LIMIT_MAX).toBe(10);
  });

  it("accepts the frozen 1..10 range and falls back outside it", () => {
    expect(isProjectOverviewV1LimitValid(1)).toBe(true);
    expect(isProjectOverviewV1LimitValid(10)).toBe(true);
    expect(isProjectOverviewV1LimitValid(0)).toBe(false);
    expect(isProjectOverviewV1LimitValid(11)).toBe(false);
    expect(isProjectOverviewV1LimitValid(2.5)).toBe(false);

    expect(
      toProjectOverviewV1Query({
        recentRecordLimit: 5,
        activeLeftoverLimit: 4,
      }),
    ).toEqual({ recentRecordLimit: 5, activeLeftoverLimit: 4 });
    expect(
      toProjectOverviewV1Query({
        recentRecordLimit: 0,
        activeLeftoverLimit: 11,
      }),
    ).toEqual({ recentRecordLimit: 3, activeLeftoverLimit: 2 });
    expect(toProjectOverviewV1Query({ recentRecordLimit: 2.5 })).toEqual({
      recentRecordLimit: 3,
      activeLeftoverLimit: 2,
    });
  });

  it("maps recent records onto the skeleton iteration view", () => {
    expect(
      fromV1RecentRecords([
        {
          recordId: 12,
          code: "CR-201",
          title: "增加商户订单号幂等校验",
          moduleId: 3,
          featureId: 9,
          featureName: "微信支付退款回调",
          publishedAt: "2026-09-10T09:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        recordId: 12,
        code: "CR-201",
        title: "增加商户订单号幂等校验",
        featureName: "微信支付退款回调",
        publishedAt: "2026-09-10T09:00:00.000Z",
      },
    ]);
    expect(fromV1RecentRecords([])).toEqual([]);
  });

  it("maps the frozen R-2 response with explicit gap nulls", () => {
    expect(
      fromV1ProjectOverview({
        project: { projectId: 7, name: "订单中台", status: "ACTIVE" },
        memberCount: 4,
        stats: {
          activeModuleCount: 2,
          activeFeatureCount: 5,
          openTaskCount: 6,
          publishedRecordCount: 9,
        },
        recentRecords: [
          {
            recordId: 12,
            code: "CR-201",
            title: "增加商户订单号幂等校验",
            moduleId: 3,
            featureId: null,
            featureName: null,
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
      }),
    ).toEqual({
      stats: {
        activeModules: 2,
        activeFeatures: 5,
        openTasks: 6,
        publishedRecords: 9,
        openLeftovers: null,
      },
      recentIterations: [
        {
          recordId: 12,
          code: "CR-201",
          title: "增加商户订单号幂等校验",
          featureName: null,
          publishedAt: "2026-09-10T09:00:00.000Z",
        },
      ],
      leftovers: [
        {
          leftoverId: 21,
          summary: "补齐恢复码入口",
          recordCode: "CR-201",
          recordTitle: null,
        },
      ],
    });
  });

  it("keeps the documented gaps stable", () => {
    expect(PROJECT_OVERVIEW_V1_MISSING_METRICS).toEqual(["openLeftovers"]);
    expect(PROJECT_OVERVIEW_V1_MISSING_FIELDS).toEqual([
      "leftover.recordTitle",
    ]);
  });
});
