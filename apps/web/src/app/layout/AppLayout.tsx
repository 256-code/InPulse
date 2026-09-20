import React, { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { CommandPalette } from "@features/command-palette/CommandPalette";
import {
  InpulseIcon,
  type InpulseIconName,
} from "@features/common/components/InpulseIcon";
import { NotificationBell } from "@features/notifications/NotificationBell";
import { ProjectTree } from "@features/project-tree/ProjectTree";
import { treeScopeOf } from "@features/project-tree/tree-selection";
import { useShellCounters } from "./shell-data";

interface NavigationItem {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly icon?: InpulseIconName;
}

/** 工作台：个人日常入口；系统目录树内嵌在「项目列表」行下。 */
const workspaceNavigation: readonly NavigationItem[] = [
  { key: "tasks", label: "任务中心", path: "/tasks", icon: "clipboard" },
  { key: "projects", label: "项目列表", path: "/projects", icon: "folder" },
];

/** 交付记录：跨项目的迭代记录与遗留问题台账。 */
const deliveryNavigation: readonly NavigationItem[] = [
  { key: "records", label: "迭代记录", path: "/records", icon: "gitBranch" },
  { key: "issues", label: "遗留问题", path: "/issues", icon: "alert" },
];

/** 全局导航：通知与搜索已收敛到侧栏底部工具条，审计仅管理员可见。 */
const globalNavigation: readonly NavigationItem[] = [
  { key: "activity", label: "项目动态", path: "/activity", icon: "activity" },
  { key: "settings", label: "成员与设置", path: "/settings", icon: "settings" },
  { key: "audit", label: "审计日志", path: "/audit", icon: "shield" },
];

const sections = [
  { prefix: "/tasks", key: "tasks", label: "任务中心" },
  { prefix: "/projects", key: "projects", label: "项目列表" },
  { prefix: "/records", key: "records", label: "迭代记录" },
  { prefix: "/issues", key: "issues", label: "遗留问题" },
  { prefix: "/activity", key: "activity", label: "项目动态" },
  { prefix: "/audit", key: "audit", label: "审计日志" },
  { prefix: "/settings", key: "settings", label: "成员与设置" },
  { prefix: "/search", key: "search", label: "全局搜索" },
  { prefix: "/notifications", key: "notifications", label: "站内通知" },
] as const;

/** 项目子页面：/projects/:projectId/<segment> 的分段、选中键与面包屑标签。 */
const projectPages = [
  { segment: "modules", key: "project-catalog", label: "项目与功能" },
  { segment: "task-board", key: "project-task-board", label: "任务看板" },
  { segment: "members", key: "project-members", label: "项目成员" },
  { segment: "activity", key: "project-activity", label: "项目动态" },
] as const;

const PROJECT_PAGE_PATTERN = /^\/projects\/\d+\/([a-z-]+)(?:\/|$)/;

function resolveProjectPage(
  pathname: string,
): (typeof projectPages)[number] | null {
  const match = PROJECT_PAGE_PATTERN.exec(pathname);
  if (!match) {
    return null;
  }
  return projectPages.find((page) => page.segment === match[1]) ?? null;
}

/** `/projects/:projectId[/modules/:moduleId[/features/:featureId]]` 的路径解析。 */
interface CatalogScope {
  readonly projectId: number | null;
  readonly moduleId: number | null;
  readonly featureId: number | null;
}

const EMPTY_CATALOG_SCOPE: CatalogScope = {
  projectId: null,
  moduleId: null,
  featureId: null,
};

const CATALOG_SCOPE_PATTERN =
  /^\/projects\/(\d+)(?:\/modules\/(\d+)(?:\/features(?:\/(\d+))?)?)?(?:\/|$)/;

function readEntityId(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 && value <= 2147483647
    ? value
    : null;
}

function readCatalogScope(pathname: string): CatalogScope {
  const match = CATALOG_SCOPE_PATTERN.exec(pathname);
  if (!match) {
    return EMPTY_CATALOG_SCOPE;
  }
  const projectId = readEntityId(match[1]);
  if (projectId === null) {
    return EMPTY_CATALOG_SCOPE;
  }
  return {
    projectId,
    moduleId: readEntityId(match[2]),
    featureId: readEntityId(match[3]),
  };
}

function resolveSection(pathname: string) {
  const projectPage = resolveProjectPage(pathname);
  if (projectPage) {
    return { key: projectPage.key, label: projectPage.label };
  }
  return sections.find((section) => pathname.startsWith(section.prefix));
}

function resolveSelectedKey(pathname: string): string | undefined {
  const section = resolveSection(pathname);
  return section?.key === "project-activity" ? "activity" : section?.key;
}

export interface AppLayoutProps {
  readonly notificationClient?: InpulseApiClient;
  readonly projectClient?: InpulseApiClient;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  notificationClient,
  projectClient,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const accountRootRef = useRef<HTMLDivElement>(null);
  const { status, user, logout } = useAuth();
  const selectedKey = resolveSelectedKey(location.pathname);
  const catalogScope = useMemo(
    () => readCatalogScope(location.pathname),
    [location.pathname],
  );
  const treeScope = useMemo(() => treeScopeOf(catalogScope), [catalogScope]);
  const displayName = user?.name.trim() || "访客";
  const avatarText = user?.name.trim().charAt(0) || "访";
  const roleLabel = user?.isAdmin ? "系统管理员" : user ? "成员" : "未登录";
  const popoverRoleLabel = user?.isAdmin
    ? "系统管理员 · 可执行高风险操作"
    : roleLabel;
  const shellCounters = useShellCounters({
    client: projectClient,
    enabled: status === "authenticated",
  });
  const shellCounts: Readonly<Record<string, number>> = useMemo(
    () => ({
      tasks: shellCounters.myOpenTaskCount ?? 0,
      issues: shellCounters.openLeftoverCount ?? 0,
    }),
    [shellCounters.myOpenTaskCount, shellCounters.openLeftoverCount],
  );
  const projectPage = useMemo(
    () => resolveProjectPage(location.pathname),
    [location.pathname],
  );
  const projectScopeId = catalogScope.projectId;
  // 全局「项目动态」在项目上下文内直达该项目动态页，避免与「当前项目」语义重复。
  const visibleGlobalNavigation = useMemo(
    () =>
      globalNavigation
        .filter((item) => user?.isAdmin || item.key !== "audit")
        .map((item) =>
          item.key === "activity" && projectScopeId !== null
            ? { ...item, path: "/projects/" + projectScopeId + "/activity" }
            : item,
        ),
    [user?.isAdmin, projectScopeId],
  );
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (!accountOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!accountRootRef.current?.contains(event.target as Node)) {
        setAccountOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAccountOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  const handleNavigation = (path: string) => {
    setMobileNavOpen(false);
    if (path !== location.pathname) {
      navigate(path);
    }
  };

  const handleOpenTarget = (targetPath: string) => {
    navigate(targetPath);
  };

  const handleOpenSearch = (query: string) => {
    navigate(`/search?${new URLSearchParams({ q: query.trim() }).toString()}`);
  };

  const handleAccountAction = async () => {
    setAccountOpen(false);
    if (status !== "authenticated") {
      // 未登录先回登录页：默认本地口令表单 + 统一身份认证入口（ADR-036）。
      navigate("/login");
      return;
    }
    setIsLoggingOut(true);
    try {
      const loggedOut = await logout()
        .then(() => true)
        .catch(() => false);
      if (loggedOut) {
        // 退出后回到登录页，由用户选择本地口令或统一身份认证（ADR-036）。
        navigate("/login");
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  const renderNavigationItem = (item: NavigationItem) => {
    const count = shellCounts[item.key] ?? 0;
    return (
      <React.Fragment key={item.key}>
        <button
          type="button"
          className={"nav-item" + (selectedKey === item.key ? " active" : "")}
          aria-current={selectedKey === item.key ? "page" : undefined}
          onClick={() => handleNavigation(item.path)}
        >
          {item.icon ? <InpulseIcon name={item.icon} size={17} /> : null}
          <span>{item.label}</span>
          {count > 0 ? (
            <em aria-hidden="true" title={`${count} 项待处理`}>
              {count}
            </em>
          ) : null}
        </button>
      </React.Fragment>
    );
  };

  if (location.pathname === "/login") {
    // 登录页使用独立的全屏视觉，不渲染工作台外壳。
    return <Outlet />;
  }

  return (
    <>
      <div className="app-shell">
        {/* 顶栏已移除：窄屏导航开关改为左上角悬浮按钮（仅 ≤700px 显示）。 */}
        <button
          type="button"
          className="icon-button menu-button"
          aria-label={mobileNavOpen ? "关闭导航" : "打开导航"}
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen((current) => !current)}
        >
          <InpulseIcon name="menu" size={20} />
        </button>
        <aside className={`sidebar${mobileNavOpen ? " sidebar-open" : ""}`}>
          <div className="brand brand-joint">
            <div className="joint-logo-frame">
              <img
                src="/inpulse-joint-logo.png"
                alt="Libiao Robotics | InPulse"
                className="joint-logo"
              />
            </div>
          </div>
          <nav className="nav-group" aria-label="工作区导航">
            <p>工作台</p>
            {workspaceNavigation.map(renderNavigationItem)}
            {projectScopeId === null &&
            location.pathname !== "/projects" ? null : (
              <>
                {/* 项目列表页也展开项目树：点「项目列表」即可直接进具体项目，
                    不必先进某个项目再切换。 */}
                <p className="nav-section">
                  {projectScopeId === null ? "项目" : "当前项目"}
                </p>
                <div className="nav-tree-panel">
                  <ProjectTree
                    activeScope={treeScope}
                    activePageSegment={projectPage?.segment ?? null}
                    onNavigate={handleNavigation}
                    {...(projectClient ? { client: projectClient } : {})}
                  />
                </div>
              </>
            )}
            <p className="nav-section">交付记录</p>
            {deliveryNavigation.map(renderNavigationItem)}
            <p className="nav-section">全局</p>
            {visibleGlobalNavigation.map(renderNavigationItem)}
          </nav>
          <div className="sidebar-footer">
            {/* 顶栏移除后账户菜单并入身份区：点击头像与姓名打开同一分组菜单。 */}
            <div
              className="popover-wrap footer-account-wrap"
              ref={accountRootRef}
            >
              <button
                type="button"
                className="footer-account"
                aria-label="账户菜单"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((current) => !current)}
              >
                <span className="person-avatar">{avatarText}</span>
                <span className="footer-account-text">
                  <strong>{displayName}</strong>
                  <small>{roleLabel}</small>
                </span>
              </button>
              {accountOpen ? (
                <div
                  className="popover account-popover"
                  role="dialog"
                  aria-label="账户菜单"
                >
                  <div className="account-identity">
                    <span className="person-avatar">{avatarText}</span>
                    <div>
                      <strong>{displayName}</strong>
                      <small>{user?.email ?? "未绑定邮箱"}</small>
                      <small>{popoverRoleLabel}</small>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleNavigation("/settings")}
                  >
                    <InpulseIcon name="users" size={15} />
                    成员与权限
                  </button>
                  <button
                    type="button"
                    disabled={isLoggingOut}
                    onClick={() => void handleAccountAction()}
                  >
                    <InpulseIcon name="logout" size={15} />
                    {isLoggingOut
                      ? "正在退出..."
                      : status === "authenticated"
                        ? "退出登录"
                        : "前往登录"}
                  </button>
                </div>
              ) : null}
            </div>
            {/* 搜索与通知收敛为底部常驻图标：窄屏不再隐藏，导航列表也不再重复入口。 */}
            <button
              type="button"
              className="icon-button"
              aria-label="打开全局搜索"
              title="全局搜索（Ctrl K）"
              onClick={() => setPaletteOpen(true)}
            >
              <InpulseIcon name="search" size={18} />
            </button>
            <NotificationBell
              client={notificationClient}
              enabled={status === "authenticated"}
              onOpen={() => handleNavigation("/notifications")}
              onOpenTarget={handleOpenTarget}
            />
          </div>
        </aside>

        <main className="content-shell">
          <div className="page-content">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        {...(notificationClient ? { client: notificationClient } : {})}
        onClose={() => setPaletteOpen(false)}
        onNavigate={handleNavigation}
        onOpenSearch={handleOpenSearch}
      />
    </>
  );
};
