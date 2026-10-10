import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { isProjectSetupComplete, ProjectSetupGuide } from "./ProjectSetupGuide";

interface GuideInputs {
  readonly moduleCount?: number;
  readonly featureCount?: number;
  readonly taskCount?: number;
  readonly featureTargetName?: string | null;
}

function mountGuide(inputs: GuideInputs = {}) {
  const handlers = {
    onCreateModule: vi.fn(),
    onAddFeature: vi.fn(),
    onCreateTask: vi.fn(),
  };
  const view = render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <ProjectSetupGuide
        moduleCount={inputs.moduleCount ?? 0}
        featureCount={inputs.featureCount ?? 0}
        taskCount={inputs.taskCount ?? 0}
        featureTargetName={inputs.featureTargetName ?? null}
        {...handlers}
      />
    </ConfigProvider>,
  );
  return { view, ...handlers };
}

describe("ProjectSetupGuide（新项目搭建引导）", () => {
  it("空项目停在第一步：后两步给出先决条件提示", () => {
    const { onCreateModule } = mountGuide();
    expect(screen.getByText("开始搭建这个项目")).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-module").className).toContain(
      "is-current",
    );
    expect(screen.getByTestId("setup-step-feature").className).toContain(
      "is-blocked",
    );
    expect(screen.getByTestId("setup-step-task").className).toContain(
      "is-blocked",
    );
    expect(screen.getAllByText("先完成第 1 步")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "添加功能" })).toBeNull();
    expect(screen.queryByRole("button", { name: "创建任务" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新增模块" }));
    expect(onCreateModule).toHaveBeenCalledTimes(1);
  });

  it("已有模块时第二步成为当前步，按钮各自触发回调", () => {
    const { onAddFeature, onCreateModule, onCreateTask } = mountGuide({
      moduleCount: 2,
      featureTargetName: "支付",
    });
    const moduleStep = screen.getByTestId("setup-step-module");
    expect(moduleStep.className).toContain("is-done");
    expect(
      within(moduleStep).getByText("已完成 · 2 个模块"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-feature").className).toContain(
      "is-current",
    );
    expect(
      screen.getByText("为「支付」建第一个功能档案。"),
    ).toBeInTheDocument();
    const addFeature = screen.getByRole("button", { name: "添加功能" });
    expect(addFeature.className).toContain("primary-button");
    fireEvent.click(addFeature);
    expect(onAddFeature).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "创建任务" }));
    expect(onCreateTask).toHaveBeenCalledTimes(1);
    expect(onCreateModule).not.toHaveBeenCalled();
  });

  it("模块与功能齐备而任务为零时，第三步成为当前步", () => {
    mountGuide({ moduleCount: 1, featureCount: 3 });
    expect(screen.getByTestId("setup-step-module").className).toContain(
      "is-done",
    );
    expect(screen.getByTestId("setup-step-feature").className).toContain(
      "is-done",
    );
    expect(
      within(screen.getByTestId("setup-step-feature")).getByText(
        "已完成 · 3 个功能",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("setup-step-task").className).toContain(
      "is-current",
    );
    expect(
      screen.getByRole("button", { name: "创建任务" }).className,
    ).toContain("primary-button");
  });

  it("三步齐备后整体隐藏", () => {
    const { view } = mountGuide({
      moduleCount: 1,
      featureCount: 1,
      taskCount: 3,
    });
    expect(view.container.firstChild).toBeNull();
  });

  it("isProjectSetupComplete 需模块、功能、任务三者各有一条记录", () => {
    expect(isProjectSetupComplete(0, 0, 0)).toBe(false);
    expect(isProjectSetupComplete(1, 0, 1)).toBe(false);
    expect(isProjectSetupComplete(1, 2, 0)).toBe(false);
    expect(isProjectSetupComplete(1, 2, 3)).toBe(true);
  });
});
