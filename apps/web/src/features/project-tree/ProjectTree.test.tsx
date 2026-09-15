import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { FeatureItem, InpulseApiClient, ModuleItem } from "@generated/api";
import { ProjectTree } from "./ProjectTree";
import type { TreeSelection, TreeScope } from "./tree-selection";

const projectItem = {
  id: 2,
  code: "AGV",
  name: "AGV 智能搬运平台",
  status: "ACTIVE",
};

const otherProjectItem = {
  id: 9,
  code: "WMS",
  name: "WMS 仓储管理",
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
    listProjects: vi
      .fn()
      .mockResolvedValue({ items: [projectItem, otherProjectItem] }),
    getProject: vi.fn().mockResolvedValue({ project: projectItem }),
    listModules: vi.fn().mockResolvedValue({ items: [moduleItem] }),
    listFeatures: vi.fn().mockResolvedValue({ items: [featureItem] }),
  } as unknown as InpulseApiClient;
}

function scopeOf(selection: TreeSelection): TreeScope {
  return { projectId: 2, selection };
}

function mount(
  client: InpulseApiClient,
  onNavigate: (path: string) => void,
  activeScope: TreeScope | null = scopeOf({ kind: "project" }),
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectTree
        activeScope={activeScope}
        onNavigate={onNavigate}
        client={client}
      />
    </QueryClientProvider>,
  );
}

describe("ProjectTree", () => {
  it("lists every project first and expands modules on click", async () => {
    const onNavigate = vi.fn();
    mount(createClient(), onNavigate, null);
    // 先罗列所有项目，未点击时不加载模块。
    expect(
      await screen.findByRole("button", { name: /AGV 智能搬运平台/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /WMS 仓储管理/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /调度模块/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /AGV 智能搬运平台/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules");
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();
  });

  it("collapses the project branch when its node is clicked again", async () => {
    const onNavigate = vi.fn();
    mount(createClient(), onNavigate, null);

    const projectButton = await screen.findByRole("button", {
      name: /AGV 智能搬运平台/,
    });
    fireEvent.click(projectButton);
    expect(projectButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();

    // 再次点击项目节点收回模块列表，并仍导航到项目主页。
    fireEvent.click(projectButton);
    expect(projectButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /调度模块/ })).toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith("/projects/2/modules");
  });

  it("drives the existing project pages for every tree level", async () => {
    const onNavigate = vi.fn();
    mount(createClient(), onNavigate);

    fireEvent.click(await screen.findByRole("button", { name: /调度模块/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features");

    fireEvent.click(await screen.findByRole("button", { name: /车辆调度/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features/5");
  });

  it("auto-expands the chain of the active project scope", async () => {
    mount(createClient(), vi.fn(), scopeOf({ kind: "module", moduleId: 3 }));
    const projectButton = await screen.findByRole("button", {
      name: /AGV 智能搬运平台/,
    });
    expect(projectButton.getAttribute("aria-expanded")).toBe("true");
    const moduleButton = await screen.findByRole("button", {
      name: /调度模块/,
    });
    expect(moduleButton.getAttribute("aria-current")).toBe("true");
    expect(
      await screen.findByRole("button", { name: /车辆调度/ }),
    ).toBeTruthy();
  });

  it("keeps the module branch expanded while its features load", async () => {
    mount(createClient(), vi.fn(), scopeOf({ kind: "module", moduleId: 3 }));
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
    mount(
      createClient(),
      vi.fn(),
      scopeOf({ kind: "feature", moduleId: 3, featureId: 5 }),
    );
    const featureButton = await screen.findByRole("button", {
      name: /车辆调度/,
    });
    expect(featureButton.getAttribute("aria-current")).toBe("true");
    const moduleButton = screen.getByRole("button", { name: /调度模块/ });
    expect(moduleButton.getAttribute("aria-expanded")).toBe("true");
    expect(moduleButton.classList.contains("in-path")).toBe(true);
  });

  it("marks the project node when the project main page is active", async () => {
    mount(createClient(), vi.fn(), scopeOf({ kind: "project" }));
    const projectButton = await screen.findByRole("button", {
      name: /AGV 智能搬运平台/,
    });
    expect(projectButton.getAttribute("aria-current")).toBe("true");
  });
});
