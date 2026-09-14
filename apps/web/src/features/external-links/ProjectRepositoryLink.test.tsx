import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import { ProjectRepositoryLink } from "./ProjectRepositoryLink";
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
    expect(
      await screen.findByRole("link", { name: /项目根仓库/ }),
    ).toHaveAttribute("href", "https://github.com/a/right");
    expect(api.listExternalLinks).toHaveBeenCalledWith(
      "PROJECT",
      7,
      expect.anything(),
    );
  });
  it("未设置根仓库时仍提供配置入口", async () => {
    mount([{ id: 1, normalizedUrl: "https://github.com/a/one" }]);
    expect(
      await screen.findByRole("button", { name: "GitHub 链接" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /项目根仓库/ })).toBeNull();
    expect(await screen.findByText("尚未配置项目根仓库")).toBeVisible();
  });
});
