import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type WecomBindingStatus,
} from "@generated/api";
import { WecomBindingModal } from "./WecomBindingModal";

const unbound: WecomBindingStatus = {
  state: "UNBOUND",
  boundAt: null,
  codeExpiresAt: null,
  botProfileUrl: null,
  robotConfigured: true,
};

const bound: WecomBindingStatus = {
  state: "BOUND",
  boundAt: "2026-10-13T02:00:00.000Z",
  codeExpiresAt: null,
  botProfileUrl: null,
  robotConfigured: true,
};

const issuedCode = {
  code: "ABCD-EFGH-JKMN-PQRS",
  expiresAt: "2099-01-01T00:00:00.000Z",
};

function mount(options: {
  readonly statuses: readonly WecomBindingStatus[];
  readonly statusError?: ApiError | undefined;
}) {
  let call = 0;
  const getWecomBinding = vi.fn().mockImplementation(async () => {
    if (options.statusError !== undefined) throw options.statusError;
    const status =
      options.statuses[Math.min(call, options.statuses.length - 1)];
    call += 1;
    return status;
  });
  const createWecomBindingCode = vi.fn().mockResolvedValue(issuedCode);
  const deleteWecomBinding = vi.fn().mockResolvedValue(undefined);
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  const client = {
    getWecomBinding,
    createWecomBindingCode,
    deleteWecomBinding,
    issueCsrfToken,
  } as unknown as InpulseApiClient;
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <WecomBindingModal open client={client} onClose={vi.fn()} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return {
    getWecomBinding,
    createWecomBindingCode,
    deleteWecomBinding,
    issueCsrfToken,
  };
}

describe("WecomBindingModal（ADR-069）", () => {
  it("未绑定时展示引导；生成绑定码只签发 CSRF 并展示一次性明文码", async () => {
    const { createWecomBindingCode, issueCsrfToken } = mount({
      statuses: [unbound],
    });
    await screen.findByText(/绑定后即可在手机上收到提醒/);

    fireEvent.click(screen.getByRole("button", { name: "生成绑定码" }));
    expect(await screen.findByLabelText("企业微信绑定码")).toHaveTextContent(
      "ABCD-EFGH-JKMN-PQRS",
    );
    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(createWecomBindingCode).toHaveBeenCalledWith({
      headers: { "x-csrf-token": "a".repeat(43) },
    });
  });

  it("生成后失效重取：第二次 GET 返回 BOUND 时自动切换为已绑定", async () => {
    const { getWecomBinding } = mount({ statuses: [unbound, bound] });
    await screen.findByText(/绑定后即可在手机上收到提醒/);

    fireEvent.click(screen.getByRole("button", { name: "生成绑定码" }));
    expect(await screen.findByText("已绑定企业微信")).toBeInTheDocument();
    expect(getWecomBinding).toHaveBeenCalledTimes(2);
  });
  it("已绑定展示绑定时间；解绑先签发 CSRF 再携带一次性幂等 Key", async () => {
    const { deleteWecomBinding } = mount({ statuses: [bound, unbound] });
    await screen.findByText("已绑定企业微信");
    expect(screen.getByText(/绑定时间：/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "解除绑定" }));
    const confirmButtons = await screen.findAllByRole("button", {
      name: "解除绑定",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(deleteWecomBinding).toHaveBeenCalledTimes(1));
    const init = deleteWecomBinding.mock.calls[0]?.[0] as
      { readonly headers: Readonly<Record<string, string>> } | undefined;
    expect(init?.headers["x-csrf-token"]).toBe("a".repeat(43));
    expect(init?.headers["Idempotency-Key"]).toMatch(/^wecom-unbind-/);
    expect(await screen.findByText("已解除绑定。")).toBeInTheDocument();
  });

  it("待用码存在但明文不在客户端时，提示有效期、引导重新生成并展示机器人链接", async () => {
    mount({
      statuses: [
        {
          state: "PENDING",
          robotConfigured: true,
          boundAt: null,
          codeExpiresAt: "2099-01-01T00:00:00.000Z",
          botProfileUrl:
            "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
        },
      ],
    });
    expect(await screen.findByText("已有一个待用绑定码")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新生成绑定码" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("机器人链接")).toHaveTextContent(
      "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
    );
  });

  it("复制绑定码写入剪贴板", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mount({ statuses: [unbound] });
    await screen.findByText(/绑定后即可在手机上收到提醒/);

    fireEvent.click(screen.getByRole("button", { name: "生成绑定码" }));
    await screen.findByLabelText("企业微信绑定码");
    fireEvent.click(screen.getByRole("button", { name: "复制绑定码" }));

    expect(
      await screen.findByText("已复制，去企业微信发给机器人"),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith("ABCD-EFGH-JKMN-PQRS");
  });

  it("服务端下发机器人链接时展示并可复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mount({
      statuses: [
        {
          ...unbound,
          botProfileUrl:
            "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
        },
      ],
    });
    await screen.findByText(/绑定后即可在手机上收到提醒/);
    expect(screen.getByLabelText("机器人链接")).toHaveTextContent(
      "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
    );
    expect(
      screen.getByText("用上面的链接在企业微信中打开机器人；"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制机器人链接" }));
    expect(
      await screen.findByText("已复制；发到企业微信任意会话中点击打开"),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
    );
  });

  it("未配置机器人链接时展示原有引导文案", async () => {
    mount({ statuses: [unbound] });
    await screen.findByText(/绑定后即可在手机上收到提醒/);
    expect(screen.queryByLabelText("机器人链接")).not.toBeInTheDocument();
    expect(
      screen.getByText("在企业微信中找到 InPulse 机器人；"),
    ).toBeInTheDocument();
  });

  it("读取失败展示错误提示且不展示生成按钮可用态", async () => {
    mount({ statuses: [], statusError: new ApiError(500, {}) });
    expect(await screen.findByText(/无法读取绑定状态/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生成绑定码" })).toBeDisabled();
  });
});
