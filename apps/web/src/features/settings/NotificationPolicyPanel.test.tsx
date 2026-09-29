import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationPolicyPanel } from "./NotificationPolicyPanel";
import { notificationScenarios } from "./settings-content";

describe("NotificationPolicyPanel", () => {
  it("renders every notification scenario with its audience", () => {
    render(<NotificationPolicyPanel />);
    const table = screen.getByRole("table", { name: "通知场景" });
    expect(
      within(table).getByRole("columnheader", { name: "事件" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "通知对象" }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(
      notificationScenarios.length + 1,
    );
    for (const scenario of notificationScenarios) {
      expect(within(table).getByText(scenario.event)).toBeInTheDocument();
      expect(within(table).getByText(scenario.audience)).toBeInTheDocument();
    }
  });

  it("explains how notifications are surfaced", () => {
    render(<NotificationPolicyPanel />);
    expect(
      screen.getByText(
        /左侧导航底部的铃铛在收到未读通知时显示红点，悬停可看到未读条数；点击铃铛展开通知中心，点开单条通知会直达对应的任务、迭代记录或项目动态。/,
      ),
    ).toBeInTheDocument();
  });
});
