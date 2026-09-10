import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import { ApiError, type InpulseApiClient } from "@generated/api";
import { ExternalLinksPanel } from "./ExternalLinksPanel";
const empty = { projectId: 1, rowVersion: 2, writable: true, items: [] };
function mount(api: InpulseApiClient) {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <ExternalLinksPanel targetType="TASK" targetId={7} client={api} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "GitHub 链接" }));
}
it("retains same semantic key after uncertain failure", async () => {
  const add = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ rowVersion: 3 });
  const api = {
    listExternalLinks: vi.fn().mockResolvedValue(empty),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "x" }),
    addExternalLink: add,
  } as unknown as InpulseApiClient;
  mount(api);
  await screen.findByLabelText("GitHub URL");
  fireEvent.change(screen.getByLabelText("GitHub URL"), {
    target: { value: "https://github.com/a/b/pull/7" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
  await screen.findByText(/输入已保留/);
  fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  expect(add.mock.calls[0]![3].headers["Idempotency-Key"]).toBe(
    add.mock.calls[1]![3].headers["Idempotency-Key"],
  );
  expect(add.mock.calls[0]![3].headers["If-Match"]).toBe('"2"');
});
it("409 refresh failure and closing never enable stale submission", async () => {
  const add = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "EXTERNAL_LINK_VERSION_CONFLICT",
        message: "changed",
        details: {},
        requestId: "r",
      }),
    )
    .mockResolvedValue({ rowVersion: 5 });
  const list = vi
    .fn()
    .mockResolvedValueOnce(empty)
    .mockRejectedValueOnce(new Error("reload"))
    .mockResolvedValue({ ...empty, rowVersion: 4 });
  mount({
    listExternalLinks: list,
    addExternalLink: add,
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "x" }),
  } as unknown as InpulseApiClient);
  await screen.findByLabelText("GitHub URL");
  fireEvent.change(screen.getByLabelText("GitHub URL"), {
    target: { value: "https://github.com/a/b" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
  await screen.findByRole("button", { name: "加载最新关联" });
  expect(screen.getByRole("button", { name: "确认添加" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "加载最新关联" }));
  await screen.findByText(/输入已保留/);
  expect(screen.getByRole("button", { name: "确认添加" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "关闭关联" }));
  fireEvent.click(screen.getByRole("button", { name: "GitHub 链接" }));
  expect(screen.getByRole("button", { name: "确认添加" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "加载最新关联" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "确认添加" })).toBeEnabled(),
  );
  expect(add).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "确认添加" }));
  await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
  expect(add.mock.calls[1]![3].headers["If-Match"]).toBe('"4"');
  expect(add.mock.calls[1]![3].headers["Idempotency-Key"]).not.toBe(
    add.mock.calls[0]![3].headers["Idempotency-Key"],
  );
});
