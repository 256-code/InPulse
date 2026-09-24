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
        /顶部导航铃铛显示未读数量，点击通知直接跳转到对应任务、功能或迭代记录。/,
      ),
    ).toBeInTheDocument();
  });
});
