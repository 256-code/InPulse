import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type CreateProjectResponse,
  type InpulseApiClient,
} from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";

const createdProject: CreateProjectResponse = {
  project: {
    id: 7,
    code: "SHOP",
    name: "商城系统",
    description: "商城项目描述",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  },
  members: [
    { userId: 1, status: "ACTIVE", joinedAt: "2026-09-09T00:00:00.000Z" },
  ],
  unclassifiedModuleId: 12,
};

function renderModal(client: InpulseApiClient) {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <CreateProjectModal
        open
        creatorName="开发者 C"
        client={client}
        onCreated={onCreated}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { onCreated, onClose };
}

async function fillForm(dialog: HTMLElement) {
  const user = userEvent.setup();
  await user.type(within(dialog).getByLabelText("项目名称"), "商城系统");
  await user.type(within(dialog).getByLabelText("项目编码"), "shop");
  await user.type(within(dialog).getByLabelText("项目描述"), "商城项目描述");
}

describe("CreateProjectModal", () => {
  it("submits normalized values with CSRF and idempotency headers", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const createProject = vi.fn().mockResolvedValue(createdProject);
    const client = {
      issueCsrfToken,
      createProject,
    } as unknown as InpulseApiClient;
    const { onCreated, onClose } = renderModal(client);

    const dialog = await screen.findByRole("dialog");
    await fillForm(dialog);
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(createProject).toHaveBeenCalledWith(
      {
        name: "商城系统",
        code: "SHOP",
        description: "商城项目描述",
        memberIds: [],
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(createdProject);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a 409 message without calling the success callback", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const createProject = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: "PROJECT_BOOTSTRAP_CONFLICT",
        message: "internal-conflict-message",
        details: {},
        requestId: "request-1",
      }),
    );
    const client = {
      issueCsrfToken,
      createProject,
    } as unknown as InpulseApiClient;
    const { onCreated, onClose } = renderModal(client);

    const dialog = await screen.findByRole("dialog");
    await fillForm(dialog);
    const user = userEvent.setup();
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    expect(
      await screen.findByText(
        "项目编码已存在或创建请求发生冲突，请刷新后重试。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("internal-conflict-message"),
    ).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
