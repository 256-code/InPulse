import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { FeatureItem, InpulseApiClient, ModuleItem } from "@generated/api";
import { ProjectTree } from "./ProjectTree";
import type { TreeSelection } from "./tree-selection";

const projectItem = {
  id: 2,
  code: "AGV",
  name: "AGV 智能搬运平台",
  status: "ACTIVE",
};

const moduleItem = {
  id: 3,
  name: "调度模块",
  status: "ACTIVE",
} as unknown as ModuleItem;

const featureItem = {
  id: 5,
  name: "车辆调度",
  status: "ACTIVE",
} as unknown as FeatureItem;

function createClient() {
  return {
    getProject: vi.fn().mockResolvedValue({ project: projectItem }),
    listModules: vi.fn().mockResolvedValue({ items: [moduleItem] }),
    listFeatures: vi.fn().mockResolvedValue({ items: [featureItem] }),
  } as unknown as InpulseApiClient;
}

function mount(
  client: InpulseApiClient,
  onNavigate: (path: string) => void,
  selection: TreeSelection = { kind: "project" },
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectTree
        projectId={2}
        selection={selection}
        onNavigate={onNavigate}
        client={client}
      />
    </QueryClientProvider>,
  );
}

describe("ProjectTree", () => {
  it("renders the system name as root folder and loads modules", async () => {
    mount(createClient(), vi.fn());
    expect(
      await screen.findByRole("button", { name: /AGV 智能搬运平台/ }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();
  });

  it("drives the existing project pages for every tree level", async () => {
    const onNavigate = vi.fn();
    const client = createClient();
    mount(client, onNavigate);

    fireEvent.click(
      await screen.findByRole("button", { name: /AGV 智能搬运平台/ }),
    );
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules");
    // 系统节点始终可展开，重复点击不会收起模块列表。
    fireEvent.click(screen.getByRole("button", { name: /AGV 智能搬运平台/ }));
    expect(screen.getByRole("button", { name: /调度模块/ })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /调度模块/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features");

    fireEvent.click(await screen.findByRole("button", { name: /车辆调度/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features/5");
  });

  it("keeps the module branch expanded while its features load", async () => {
    mount(createClient(), vi.fn(), { kind: "module", moduleId: 3 });
    const moduleButton = await screen.findByRole("button", {
      name: /调度模块/,
    });
    expect(moduleButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      await screen.findByRole("button", { name: /车辆调度/ }),
    ).toBeTruthy();
    fireEvent.click(moduleButton);
    expect(moduleButton.getAttribute("aria-expanded")).toBe("false");
  });

  it("highlights the feature row and keeps its module in path", async () => {
    mount(createClient(), vi.fn(), {
      kind: "feature",
      moduleId: 3,
      featureId: 5,
    });
    const featureButton = await screen.findByRole("button", {
      name: /车辆调度/,
    });
    expect(featureButton.getAttribute("aria-current")).toBe("true");
    const moduleButton = screen.getByRole("button", { name: /调度模块/ });
    expect(moduleButton.getAttribute("aria-expanded")).toBe("true");
    expect(moduleButton.classList.contains("in-path")).toBe(true);
  });

  it("marks the project node when the project main page is active", async () => {
    mount(createClient(), vi.fn(), { kind: "project" });
    const projectButton = await screen.findByRole("button", {
      name: /AGV 智能搬运平台/,
    });
    expect(projectButton.getAttribute("aria-current")).toBe("true");
  });
});
