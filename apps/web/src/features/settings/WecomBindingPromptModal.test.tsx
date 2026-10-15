import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type WecomBindingStatus,
} from "@generated/api";
import { WecomBindingPromptModal } from "./WecomBindingPromptModal";
import {
  WECOM_BINDING_PROMPT_SESSION_KEY,
  WECOM_BINDING_PROMPT_STORAGE_KEY,
} from "./wecom-binding-prompt";

const PROMPT_TITLE = "绑定企业微信，及时收到任务提醒";

const unboundStatus: WecomBindingStatus = {
  state: "UNBOUND",
  boundAt: null,
  codeExpiresAt: null,
  botProfileUrl: null,
  robotConfigured: true,
};

function mount(options: {
  readonly status?: WecomBindingStatus | undefined;
  readonly statusError?: Error | undefined;
  readonly enabled?: boolean;
  readonly userId?: number | null;
}) {
  const getWecomBinding = vi.fn().mockImplementation(async () => {
    if (options.statusError !== undefined) throw options.statusError;
    return options.status ?? unboundStatus;
  });
  const client = { getWecomBinding } as unknown as InpulseApiClient;
  const onGoBind = vi.fn();
  const view = render(
    <ConfigProvider
      theme={{ token: { motion: false } }}
      button={{ autoInsertSpace: false }}
    >
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WecomBindingPromptModal
          enabled={options.enabled ?? true}
          userId={options.userId === undefined ? 1 : options.userId}
          client={client}
          onGoBind={onGoBind}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { getWecomBinding, onGoBind, ...view };
}

/** 给未启用查询的场景留一轮宏任务，确认确实没有发起请求。 */
async function flushMacrotask(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** 断言提醒弹窗已关闭：antd 关闭后保留隐藏 DOM，因此按可见性判断而不是是否在文档中。 */
async function expectPromptClosed(): Promise<void> {
  await waitFor(() => {
    const title = screen.queryByText(PROMPT_TITLE);
    if (title !== null) {
      expect(title).not.toBeVisible();
    }
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("WecomBindingPromptModal（ADR-079）", () => {
  it("未绑定且机器人已配置时弹出提醒，并提供三个动作", async () => {
    mount({});
    expect(await screen.findByText(PROMPT_TITLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忽略" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "不再提醒" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "去绑定" })).toBeInTheDocument();
    expect(
      screen.getByText(/任务被指派给你时，企业微信机器人会在手机上提醒你/),
    ).toBeInTheDocument();
  });

  it("机器人未配置时不弹提醒", async () => {
    const { getWecomBinding } = mount({
      status: { ...unboundStatus, robotConfigured: false },
    });
    await waitFor(() => expect(getWecomBinding).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("已绑定与待用码状态都不弹提醒", async () => {
    const boundView = mount({
      status: {
        ...unboundStatus,
        state: "BOUND",
        boundAt: "2026-10-13T02:00:00.000Z",
      },
    });
    await waitFor(() =>
      expect(boundView.getWecomBinding).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
    boundView.unmount();

    const pendingView = mount({
      status: {
        ...unboundStatus,
        state: "PENDING",
        codeExpiresAt: "2099-01-01T00:00:00.000Z",
      },
    });
    await waitFor(() =>
      expect(pendingView.getWecomBinding).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("读取失败时静默不弹", async () => {
    const { getWecomBinding } = mount({ statusError: new ApiError(500, {}) });
    await waitFor(() => expect(getWecomBinding).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("本次会话已忽略时不再请求状态也不弹", async () => {
    window.sessionStorage.setItem(
      WECOM_BINDING_PROMPT_SESSION_KEY,
      JSON.stringify([1]),
    );
    const { getWecomBinding } = mount({});
    await flushMacrotask();
    expect(getWecomBinding).not.toHaveBeenCalled();
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("已选择不再提醒时（持久记录）不再请求状态也不弹", async () => {
    window.localStorage.setItem(
      WECOM_BINDING_PROMPT_STORAGE_KEY,
      JSON.stringify([1]),
    );
    const { getWecomBinding } = mount({});
    await flushMacrotask();
    expect(getWecomBinding).not.toHaveBeenCalled();
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("未登录（enabled=false 或 userId=null）时不请求状态也不弹", async () => {
    const disabledView = mount({ enabled: false });
    await flushMacrotask();
    expect(disabledView.getWecomBinding).not.toHaveBeenCalled();
    disabledView.unmount();

    const anonymousView = mount({ userId: null });
    await flushMacrotask();
    expect(anonymousView.getWecomBinding).not.toHaveBeenCalled();
    expect(screen.queryByText(PROMPT_TITLE)).not.toBeInTheDocument();
  });

  it("「忽略」关闭提醒并写入本次会话记录，不写持久存储", async () => {
    mount({});
    fireEvent.click(await screen.findByRole("button", { name: "忽略" }));
    await expectPromptClosed();
    expect(
      JSON.parse(
        window.sessionStorage.getItem(WECOM_BINDING_PROMPT_SESSION_KEY) ?? "[]",
      ),
    ).toEqual([1]);
    expect(
      window.localStorage.getItem(WECOM_BINDING_PROMPT_STORAGE_KEY),
    ).toBeNull();
  });

  it("「不再提醒」关闭提醒并写入按账号的持久记录", async () => {
    mount({});
    fireEvent.click(await screen.findByRole("button", { name: "不再提醒" }));
    await expectPromptClosed();
    expect(
      JSON.parse(
        window.localStorage.getItem(WECOM_BINDING_PROMPT_STORAGE_KEY) ?? "[]",
      ),
    ).toEqual([1]);
    expect(
      window.sessionStorage.getItem(WECOM_BINDING_PROMPT_SESSION_KEY),
    ).toBeNull();
  });

  it("「去绑定」关闭提醒并回调 onGoBind", async () => {
    const { onGoBind } = mount({});
    fireEvent.click(await screen.findByRole("button", { name: "去绑定" }));
    expect(onGoBind).toHaveBeenCalledTimes(1);
    await expectPromptClosed();
    expect(
      JSON.parse(
        window.sessionStorage.getItem(WECOM_BINDING_PROMPT_SESSION_KEY) ?? "[]",
      ),
    ).toEqual([1]);
  });
});
