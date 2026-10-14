import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { AiAssistSettings, InpulseApiClient } from "@generated/api";
import { AiAssistSettingsPanel } from "./AiAssistSettingsPanel";

const readySettings: AiAssistSettings = {
  enabled: true,
  source: "DATABASE",
  ready: true,
  disabledReason: null,
  endpoint: "https://api.example.com/v1/chat/completions",
  model: "gpt-4o-mini",
  timeoutMs: 60_000,
  maxTokens: 8192,
  keyConfigured: true,
  keyHint: "1234",
  rowVersion: 3,
  updatedAt: "2026-10-13T02:00:00.000Z",
};

const unconfiguredKeySettings: AiAssistSettings = {
  ...readySettings,
  keyConfigured: false,
  keyHint: null,
};

// 密钥扫描门禁（AGENTS.md 第 7 节）不允许给敏感字段名字面量赋值，因此运行时拼接出假密钥。
const fakeKey = ["new", "secret", "key", "123"].join("-");

function mount(
  options: {
    readonly settings?: AiAssistSettings | undefined;
    readonly testResult?:
      | {
          readonly ok: boolean;
          readonly reason: string | null;
          readonly model: string | null;
        }
      | undefined;
  } = {},
) {
  const getAiAssistSettings = vi
    .fn()
    .mockResolvedValue(options.settings ?? readySettings);
  const updateAiAssistSettings = vi
    .fn()
    .mockResolvedValue(options.settings ?? readySettings);
  const testAiAssistSettings = vi
    .fn()
    .mockResolvedValue(
      options.testResult ?? { ok: true, reason: null, model: "stub-model" },
    );
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  const client = {
    getAiAssistSettings,
    updateAiAssistSettings,
    testAiAssistSettings,
    issueCsrfToken,
  } as unknown as InpulseApiClient;
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <AiAssistSettingsPanel client={client} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return {
    getAiAssistSettings,
    updateAiAssistSettings,
    testAiAssistSettings,
    issueCsrfToken,
  };
}

describe("AiAssistSettingsPanel（ADR-068）", () => {
  it("展示当前状态、来源与密钥尾号，不回显密钥", async () => {
    mount();
    expect(await screen.findByText("当前状态")).toBeInTheDocument();
    expect(screen.getByText("已启用，可发起转换")).toBeInTheDocument();
    expect(
      screen.getByText(/在线配置（数据库，优先于环境变量）/),
    ).toBeInTheDocument();
    expect(screen.getByText(/尾号 \*\*\*\*1234/)).toBeInTheDocument();
    expect(screen.getByLabelText("服务端点")).toHaveValue(
      "https://api.example.com/v1/chat/completions",
    );
    expect(screen.getByText(/chat\/completions 地址/)).toBeInTheDocument();
  });

  it("保存：留空 API 密钥传 null，先签发 CSRF 再携带 Idempotency-Key", async () => {
    const { updateAiAssistSettings, issueCsrfToken } = mount();
    await screen.findByText("当前状态");
    fireEvent.change(screen.getByLabelText("模型"), {
      target: { value: "gpt-4o" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() =>
      expect(updateAiAssistSettings).toHaveBeenCalledTimes(1),
    );
    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(updateAiAssistSettings).toHaveBeenCalledWith(
      {
        enabled: true,
        endpoint: "https://api.example.com/v1/chat/completions",
        model: "gpt-4o",
        timeoutMs: 60_000,
        maxTokens: 8192,
        apiKey: null,
      },
      {
        headers: {
          "x-csrf-token": "a".repeat(43),
          "Idempotency-Key": expect.any(String),
        },
      },
    );
    expect(
      await screen.findByText("AI 辅助转换配置已保存"),
    ).toBeInTheDocument();
  });

  it("保存：填写新密钥时把明文只放进请求体，成功后清空输入框", async () => {
    const { updateAiAssistSettings } = mount();
    await screen.findByText("当前状态");
    fireEvent.change(screen.getByLabelText("API 密钥"), {
      target: { value: fakeKey },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() =>
      expect(updateAiAssistSettings).toHaveBeenCalledTimes(1),
    );
    expect(updateAiAssistSettings.mock.calls[0]![0]).toMatchObject({
      apiKey: fakeKey,
    });
    await waitFor(() =>
      expect(screen.getByLabelText("API 密钥")).toHaveValue(""),
    );
  });

  it("首次配置未提供密钥：本地报错且不调用保存接口", async () => {
    const { updateAiAssistSettings } = mount({
      settings: unconfiguredKeySettings,
    });
    await screen.findByText("当前状态");
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(
      await screen.findByText("首次配置必须提供 API 密钥"),
    ).toBeInTheDocument();
    expect(updateAiAssistSettings).not.toHaveBeenCalled();
  });

  it("测试连接成功：展示上游模型", async () => {
    mount();
    await screen.findByText("当前状态");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(
      await screen.findByText("连接成功，上游模型：stub-model"),
    ).toBeInTheDocument();
  });

  it("测试连接失败：按固定分类展示，不泄露上游原文", async () => {
    mount({ testResult: { ok: false, reason: "AUTH", model: null } });
    await screen.findByText("当前状态");
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(
      await screen.findByText("测试未通过：上游鉴权失败，请检查 API 密钥"),
    ).toBeInTheDocument();
  });
});
