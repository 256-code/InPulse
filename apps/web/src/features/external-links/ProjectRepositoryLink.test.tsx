import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import {
  ProjectRepositoryLink,
  repositoryDisplayPath,
} from "./ProjectRepositoryLink";
function mount(items: object[]) {
  const api = {
    listExternalLinks: vi
      .fn()
      .mockResolvedValue({ items, rowVersion: 1, writable: true }),
  } as unknown as InpulseApiClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectRepositoryLink projectId={7} client={api} />
    </QueryClientProvider>,
  );
  return api;
}
describe("project repository", () => {
  it("直达明确标记的根仓库，不取第一个关联", async () => {
    const api = mount([
      {
        id: 1,
        normalizedUrl: "https://github.com/a/wrong",
        isRootRepository: false,
      },
      {
        id: 2,
        normalizedUrl: "https://github.com/a/right",
        isRootRepository: true,
      },
    ]);
    const rootLink = await screen.findByRole("link", {
      name: /项目根仓库/,
    });
    expect(rootLink).toHaveAttribute("href", "https://github.com/a/right");
    // 跳转按钮展示 owner/repo 短标识，完整地址放进 title。
    expect(rootLink).toHaveClass("repo-jump-button");
    expect(rootLink.textContent).toContain("a/right");
    expect(rootLink.textContent).not.toContain("github.com");
    expect(rootLink).toHaveAttribute(
      "title",
      "项目根仓库：https://github.com/a/right",
    );
    // 已配置根仓库时按钮保持常规样式，不标记待配置。
    expect(
      (await screen.findByRole("button", { name: "GitHub 链接" })).className,
    ).not.toContain("is-unconfigured");
    expect(api.listExternalLinks).toHaveBeenCalledWith(
      "PROJECT",
      7,
      expect.anything(),
    );
  });
  it("短标识只取 owner/repo，并容忍 .git 后缀与更深的路径", () => {
    expect(repositoryDisplayPath("https://github.com/256-code/InPulse")).toBe(
      "256-code/InPulse",
    );
    expect(
      repositoryDisplayPath("https://github.com/256-code/InPulse.git"),
    ).toBe("256-code/InPulse");
    expect(repositoryDisplayPath("https://github.com/o/r/tree/main/pkg")).toBe(
      "o/r",
    );
  });
  it("解析不出 owner/repo 时回退为原地址", () => {
    expect(repositoryDisplayPath("https://github.com/only-owner")).toBe(
      "https://github.com/only-owner",
    );
    expect(repositoryDisplayPath("not a url")).toBe("not a url");
  });
  it("未设置根仓库时入口按钮标记待配置并给出悬停提示", async () => {
    mount([{ id: 1, normalizedUrl: "https://github.com/a/one" }]);
    // 等链接查询落定后再断言：待配置标记来自接口返回「没有根仓库」。
    const trigger = await screen.findByTitle("尚未配置项目根仓库");
    expect(trigger).toBeVisible();
    expect(screen.queryByRole("link", { name: /项目根仓库/ })).toBeNull();
    // 状态不再用单独一行文案表达：按钮自身虚线标记，具体原因放 title。
    expect(trigger.className).toContain("is-unconfigured");
    expect(trigger).toHaveAttribute("title", "尚未配置项目根仓库");
    expect(screen.queryByText("尚未配置项目根仓库")).toBeNull();
  });
});
