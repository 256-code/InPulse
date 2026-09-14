import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import { GlobalTaskCreateModal } from "./GlobalTaskCreateModal";

const projects = [
  {
    id: 1,
    code: "INP",
    name: "InPulse 平台",
    description: "说明",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    memberCount: 4,
    stats: { activeModuleCount: 2, activeFeatureCount: 5, openTaskCount: 3 },
  },
] as const;

const modules = [
  {
    id: 11,
    projectId: 1,
    name: "访问控制",
    description: "说明",
    status: "ACTIVE",
    sortOrder: 0,
    archivedAt: null,
    rowVersion: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
] as const;

const features = [
  {
    id: 111,
    projectId: 1,
    moduleId: 11,
    name: "MFA 登录",
    description: "说明",
    status: "ACTIVE",
    archivedAt: null,
    rowVersion: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
  {
    id: 112,
    projectId: 1,
    moduleId: 11,
    name: "会话管理",
    description: "说明",
    status: "ACTIVE",
    archivedAt: null,
    rowVersion: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
] as const;

const members = [
  { id: 1, name: "陈晓", avatarUrl: null },
  { id: 2, name: "李雷", avatarUrl: null },
] as const;

interface Harness {
  readonly client: InpulseApiClient;
  readonly createTask: ReturnType<typeof vi.fn>;
  readonly createModuleTask: ReturnType<typeof vi.fn>;
  readonly addExternalLink: ReturnType<typeof vi.fn>;
  readonly onClose: () => void;
  readonly onCreated: (taskId: number) => void;
}

function harness(
  overrides: {
    readonly createTask?: () => Promise<unknown>;
    readonly addExternalLink?: () => Promise<unknown>;
  } = {},
): Harness {
  const createTask =
    overrides.createTask ??
    (() => Promise.resolve({ id: 901, code: "T-901", rowVersion: 1 }));
  const createModuleTask = vi.fn(() =>
    Promise.resolve({ id: 902, code: "T-902", rowVersion: 1 }),
  );
  const addExternalLink =
    overrides.addExternalLink ?? (() => Promise.resolve({ linkId: 1 }));
  const onClose = vi.fn<() => void>(() => undefined);
  const onCreated = vi.fn<(taskId: number) => void>(() => undefined);

  const client = {
    createApiClient: undefined,
    issueCsrfToken: vi.fn(() =>
      Promise.resolve({ csrfToken: "csrf-token", expiresAt: "2026-09-01" }),
    ),
    listProjects: vi.fn(() => Promise.resolve({ items: [...projects] })),
    listModules: vi.fn(() => Promise.resolve({ items: [...modules] })),
    listFeatures: vi.fn(() => Promise.resolve({ items: [...features] })),
    listTaskAssignees: vi.fn(() => Promise.resolve({ items: [...members] })),
    listModuleTaskAssignees: vi.fn(() =>
      Promise.resolve({ items: [...members] }),
    ),
    createTask: vi.fn(createTask),
    createModuleTask,
    addExternalLink: vi.fn(addExternalLink),
  } as unknown as InpulseApiClient;

  return {
    client,
    createTask: (client as unknown as { createTask: ReturnType<typeof vi.fn> })
      .createTask,
    createModuleTask,
    addExternalLink: (
      client as unknown as { addExternalLink: ReturnType<typeof vi.fn> }
    ).addExternalLink,
    onClose,
    onCreated,
  };
}

function mount(
  test: Harness,
  props: {
    readonly preset?: {
      readonly projectId?: number;
      readonly moduleId?: number;
      readonly featureId?: number;
    };
  } = {},
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <GlobalTaskCreateModal
        open
        client={test.client}
        onClose={test.onClose}
        onCreated={test.onCreated}
        {...(props.preset ? { preset: props.preset } : {})}
      />
    </QueryClientProvider>,
  );
}

describe("GlobalTaskCreateModal", () => {
  it("keeps the form gated until the task has a real project/module/feature home", async () => {
    const test = harness();
    mount(test);
    const user = userEvent.setup();

    const assignee = await screen.findByLabelText("指派给");
    expect(assignee).toBeDisabled();
    // 归属没选全之前成员请求本就不该发出，不能显示一直不变的加载提示。
    expect(screen.queryByText("正在加载项目成员…")).toBeNull();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();

    await user.selectOptions(await screen.findByLabelText("所属项目"), "1");
    await waitFor(() =>
      expect(screen.getByLabelText("所属模块")).toBeEnabled(),
    );
    await user.selectOptions(screen.getByLabelText("所属模块"), "11");
    await waitFor(() =>
      expect(screen.getByLabelText("所属功能")).toBeEnabled(),
    );

    // 归属尚未选到功能之前，指派人与提交按钮都不该解锁。
    expect(screen.getByLabelText("指派给")).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("所属功能"), "111");
    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    expect(
      await screen.findByRole("option", { name: "李雷" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeEnabled();
  });

  it("shows the member loading hint only while the request is in flight", async () => {
    const test = harness();
    const gate: { release: () => void } = { release: () => undefined };
    (
      test.client as unknown as { listTaskAssignees: () => Promise<unknown> }
    ).listTaskAssignees = vi.fn(
      () =>
        new Promise((resolve) => {
          gate.release = () =>
            resolve({ items: members.map((item) => ({ ...item })) });
        }),
    );

    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });

    expect(await screen.findByText("正在加载项目成员…")).toBeInTheDocument();
    gate.release();
    await waitFor(() =>
      expect(screen.queryByText("正在加载项目成员…")).toBeNull(),
    );
    expect(
      await screen.findByRole("option", { name: "李雷" }),
    ).toBeInTheDocument();
  });

  it("resets the dependent selections when the project changes", async () => {
    const test = harness();
    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByLabelText("所属功能")).toHaveValue("111"),
    );

    await user.selectOptions(screen.getByLabelText("所属项目"), "0");

    expect(screen.getByLabelText("所属模块")).toHaveValue("0");
    expect(screen.getByLabelText("所属功能")).toHaveValue("0");
    expect(screen.getByLabelText("指派给")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
  });

  it("creates a feature task with CSRF and an idempotency key, then closes", async () => {
    const test = harness();
    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("任务标题"), "补齐恢复码入口");
    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("指派给"), "2");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(test.createTask).toHaveBeenCalledTimes(1));
    expect(test.createTask).toHaveBeenCalledWith(
      1,
      11,
      111,
      {
        title: "补齐恢复码入口",
        description: "",
        priority: "NORMAL",
        assigneeId: 2,
        dueAt: null,
      },
      {
        headers: {
          "x-csrf-token": "csrf-token",
          "Idempotency-Key": expect.stringMatching(/^task-/),
        },
      },
    );
    await waitFor(() => expect(test.onCreated).toHaveBeenCalledWith(901));
    expect(test.onClose).toHaveBeenCalled();
  });

  it("creates a module task with impact features and skips the feature selector", async () => {
    const test = harness();
    mount(test, { preset: { projectId: 1, moduleId: 11 } });
    const user = userEvent.setup();

    // 预置了模块则默认范围是模块级，此时不应该出现「所属功能」。
    expect(screen.queryByLabelText("所属功能")).toBeNull();

    await user.type(await screen.findByLabelText("任务标题"), "模块级任务");
    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("指派给"), "1");
    await user.click(await screen.findByLabelText("会话管理"));
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(test.createModuleTask).toHaveBeenCalledTimes(1));
    expect(test.createModuleTask).toHaveBeenCalledWith(
      1,
      11,
      {
        title: "模块级任务",
        description: "",
        priority: "NORMAL",
        assigneeId: 1,
        dueAt: null,
        impactFeatureIds: [112],
      },
      {
        headers: {
          "x-csrf-token": "csrf-token",
          "Idempotency-Key": expect.stringMatching(/^task-/),
        },
      },
    );
  });

  it("reports the links that could not be attached without losing the task", async () => {
    const test = harness({
      addExternalLink: () => Promise.reject(new Error("rejected")),
    });
    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("任务标题"), "带链接的任务");
    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("指派给"), "1");
    await user.type(
      screen.getByLabelText("GitHub 链接"),
      "https://github.com/256-code/InPulse/pull/1",
    );
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() =>
      expect(
        screen.getByText(/任务已创建，但 1 个 GitHub 链接未能关联/),
      ).toBeInTheDocument(),
    );
    expect(test.onCreated).toHaveBeenCalledWith(901);
    // 链接失败时保留弹窗与表单，用户可以直接复制链接或修改后重试。
    expect(test.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("任务标题")).toHaveValue("带链接的任务");
  });

  it("blocks submission with an explicit reason instead of hitting the API", async () => {
    const test = harness();
    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });
    const user = userEvent.setup();

    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByText("请输入任务标题。")).toBeInTheDocument();
    expect(test.createTask).not.toHaveBeenCalled();
  });

  it("surfaces the server error text and keeps the draft", async () => {
    const test = harness({
      createTask: () =>
        Promise.reject(
          Object.assign(new Error("字段校验错误"), {
            name: "ApiError",
            status: 422,
          }),
        ),
    });
    mount(test, { preset: { projectId: 1, moduleId: 11, featureId: 111 } });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("任务标题"), "重复标题");
    await waitFor(() => expect(screen.getByLabelText("指派给")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("指派给"), "1");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(test.createTask).toHaveBeenCalledTimes(1));
    expect(test.onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText("任务标题")).toHaveValue("重复标题");
  });
});
