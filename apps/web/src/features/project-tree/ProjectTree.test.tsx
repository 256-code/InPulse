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
  activePageSegment: string | null = null,
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ProjectTree
        activeScope={activeScope}
        activePageSegment={activePageSegment}
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
    // 模块列表挂在「模块与功能」子页行下：展开子页行后才加载模块。
    fireEvent.click(await screen.findByRole("button", { name: "模块与功能" }));
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();
  });

  it("keeps the module list in its own scroll area so other projects stay visible", async () => {
    const { container } = mount(createClient(), vi.fn(), null);

    fireEvent.click(
      await screen.findByRole("button", { name: /AGV 智能搬运平台/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "模块与功能" }));
    const moduleButton = await screen.findByRole("button", {
      name: /调度模块/,
    });

    // 回归防线：模块列表必须落在自己的滚动区（.tree-modules-scroll，CSS 限高
    // 200px 且滚动条槽常驻）里，侧栏不再让所有项目共用一条滚动条；子页行留在
    // 滚动区之外，始终可见。折叠动画在 .tree-children / .tree-modules 两层上，
    // 中间多一层 .tree-children-clip 负责裁剪，故这里用后代选择器定位。
    const scrollArea = container.querySelector(
      ".project-tree-scroll > .tree-project > .tree-children .tree-modules-scroll",
    );
    expect(scrollArea?.contains(moduleButton)).toBe(true);
    expect(
      scrollArea?.contains(screen.getByRole("button", { name: "模块与功能" })),
    ).toBe(false);
  });

  it("marks collapsed branches as hidden while the fold animation runs", async () => {
    const { container } = mount(createClient(), vi.fn(), null);
    const agv = await screen.findByRole("button", { name: /AGV 智能搬运平台/ });
    const branch = container.querySelector(
      ".project-tree-scroll > .tree-project > .tree-children",
    );
    // 收起态：高度交给 CSS 的 grid-template-rows 过渡压到 0，data-open 记录状态，
    // aria-hidden 让内容在收起（含动画窗口）期间对辅助技术与查询都不可见。
    expect(branch).toHaveAttribute("data-open", "false");
    expect(branch).toHaveAttribute("aria-hidden", "true");

    fireEvent.click(agv);
    expect(branch).toHaveAttribute("data-open", "true");
    expect(branch).not.toHaveAttribute("aria-hidden");

    // 再次点击立即翻转状态：内容仍在 DOM 里等收起动画走完（延迟卸载），
    // 但已不可查询，不会出现「动画还在放、列表却已能点到」的中间态。
    fireEvent.click(agv);
    expect(branch).toHaveAttribute("data-open", "false");
    expect(branch).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button", { name: "模块与功能" })).toBeNull();
  });

  it("keeps every project row listed while one project is expanded", async () => {
    mount(createClient(), vi.fn(), null);
    fireEvent.click(
      await screen.findByRole("button", { name: /AGV 智能搬运平台/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "模块与功能" }));
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();
    // 展开的子树只挂在被打开的项目下面：其它项目行仍留在同一个罗列区里，
    // 不因为某个项目展开而消失（产品要求 2026-09-21）。
    expect(screen.getByRole("button", { name: /WMS 仓储管理/ })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /AGV 智能搬运平台/ }),
    ).toHaveLength(1);
  });

  it("collapses the project branch when its node is clicked again", async () => {
    const onNavigate = vi.fn();
    mount(createClient(), onNavigate, null);

    const projectButton = await screen.findByRole("button", {
      name: /AGV 智能搬运平台/,
    });
    fireEvent.click(projectButton);
    expect(projectButton.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(await screen.findByRole("button", { name: "模块与功能" }));
    expect(
      await screen.findByRole("button", { name: /调度模块/ }),
    ).toBeTruthy();

    // 再次点击项目节点收回整个子页列表（含模块列表），并仍导航到项目主页。
    fireEvent.click(projectButton);
    expect(projectButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /调度模块/ })).toBeNull();
    expect(onNavigate).toHaveBeenLastCalledWith("/projects/2/modules");
  });

  it("drives the existing project pages for every tree level", async () => {
    const onNavigate = vi.fn();
    mount(createClient(), onNavigate);

    // 当前项目作用域自动铺开子页行；模块列表要点开「模块与功能」。
    fireEvent.click(await screen.findByRole("button", { name: "模块与功能" }));
    fireEvent.click(await screen.findByRole("button", { name: /调度模块/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features");

    fireEvent.click(await screen.findByRole("button", { name: /车辆调度/ }));
    expect(onNavigate).toHaveBeenCalledWith("/projects/2/modules/3/features/5");
  });

  it("auto-expands the chain of the active project scope", async () => {
    mount(
      createClient(),
      vi.fn(),
      scopeOf({ kind: "module", moduleId: 3 }),
      "modules",
    );
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

  it("keeps the expanded chain when returning to the project overview", async () => {
    const client = createClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (activeScope: TreeScope, activePageSegment: string) => (
      <QueryClientProvider client={queryClient}>
        <ProjectTree
          activeScope={activeScope}
          activePageSegment={activePageSegment}
          onNavigate={vi.fn()}
          client={client}
        />
      </QueryClientProvider>
    );
    const view = render(
      tree(scopeOf({ kind: "feature", moduleId: 3, featureId: 5 }), "modules"),
    );
    expect(
      (await screen.findByRole("button", { name: /调度模块/ })).getAttribute(
        "aria-expanded",
      ),
    ).toBe("true");
    await screen.findByRole("button", { name: /车辆调度/ });

    // 面包屑回到项目概况（系统级作用域）后，已展开的模块与功能保持可见。
    view.rerender(tree(scopeOf({ kind: "project" }), "overview"));
    expect(
      screen
        .getByRole("button", { name: /调度模块/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByRole("button", { name: /车辆调度/ })).toBeTruthy();
  });

  it("keeps the module branch expanded while its features load", async () => {
    mount(
      createClient(),
      vi.fn(),
      scopeOf({ kind: "module", moduleId: 3 }),
      "modules",
    );
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
      "modules",
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
