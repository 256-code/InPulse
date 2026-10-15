import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppModal } from "./AppModal";

function mount(ui: React.ReactElement) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>,
  );
}

function openModal(onCancel: () => void) {
  mount(
    <AppModal open title="生成总结" onCancel={onCancel}>
      <div data-testid="head-item">对总结的要求</div>
      <div data-testid="body-item">总结正文</div>
    </AppModal>,
  );
  return screen.getByRole("dialog", { name: "生成总结" });
}

describe("AppModal", () => {
  it("点击盒子自身留白会关闭", () => {
    const onCancel = vi.fn();
    const box = openModal(onCancel);
    fireEvent.mouseDown(box);
    fireEvent.mouseUp(box);
    fireEvent.click(box);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("点击子元素不关闭", () => {
    const onCancel = vi.fn();
    openModal(onCancel);
    fireEvent.click(screen.getByTestId("body-item"));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("拖选跨子元素松手后合成到盒子的 click 不关闭", async () => {
    const onCancel = vi.fn();
    const box = openModal(onCancel);
    // 浏览器对「按下与抬起在不同子元素」的拖选会把 click 的 target 合成到
    // 公共祖先（盒子自身）；按下点在子元素上，不能当成点留白关闭。
    fireEvent.mouseDown(screen.getByTestId("head-item"));
    fireEvent.mouseUp(screen.getByTestId("body-item"));
    fireEvent.click(box);
    expect(onCancel).not.toHaveBeenCalled();
    // antd 弹层出现动画 prepare 阶段 jsdom 判不可见，等动画类摘掉再断言。
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "生成总结" })).toBeVisible(),
    );
  });
});
