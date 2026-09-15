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
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import { ProjectTree } from "@features/project-tree/ProjectTree";
import { treeScopeOf } from "@features/project-tree/tree-selection";
import { useCatalogTrail, useShellCounters } from "./shell-data";

interface NavigationItem {
  readonly key: string;
  readonly label: string;
  readonly path: string;
  readonly icon: InpulseIconName;
}

const workspaceNavigation: readonly NavigationItem[] = [
  { key: "tasks", label: "任务中心", path: "/tasks", icon: "clipboard" },
  { key: "projects", label: "项目与功能", path: "/projects", icon: "folder" },
  { key: "records", label: "迭代记录", path: "/records", icon: "gitBranch" },
  { key: "issues", label: "遗留问题", path: "/issues", icon: "alert" },
];

const systemNavigation: readonly NavigationItem[] = [
  { key: "activity", label: "项目动态", path: "/activity", icon: "activity" },
  { key: "settings", label: "成员与设置", path: "/settings", icon: "settings" },
  // 设计师稿的系统组只有上两项；动态审计是仓库已有能力，保留为管理员专属末项。
  { key: "audit", label: "动态审计", path: "/audit", icon: "shield" },
];

const sections = [
  { prefix: "/tasks", key: "tasks", label: "任务中心" },
  { prefix: "/task-groups", key: "tasks", label: "任务中心" },
  { prefix: "/projects", key: "projects", label: "项目与功能" },
  { prefix: "/records", key: "records", label: "迭代记录" },
  { prefix: "/issues", key: "issues", label: "遗留问题" },
  { prefix: "/activity", key: "activity", label: "项目动态" },
  { prefix: "/audit", key: "audit", label: "动态审计" },
  { prefix: "/settings", key: "settings", label: "成员与设置" },
  { prefix: "/search", key: "search", label: "全局搜索" },
  { prefix: "/notifications", key: "notifications", label: "通知中心" },
] as const;

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
  if (/^\/projects\/[^/]+\/activity(?:\/|$)/.test(pathname)) {
    return { key: "project-activity", label: "项目动态" };
  }
  return sections.find((section) => pathname.startsWith(section.prefix));
}

function resolveSelectedKey(pathname: string): string | undefined {
  const section = resolveSection(pathname);
  return section?.key === "project-activity" ? "activity" : section?.key;
}

function resolveSectionLabel(pathname: string): string {
  return resolveSection(pathname)?.label ?? "工作台";
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
  const [reauthOpen, setReauthOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // 系统目录内嵌在「项目与功能」导航项下：进入项目路由自动展开，也可手动开合。
  const [catalogOpen, setCatalogOpen] = useState(false);
  const accountRootRef = useRef<HTMLDivElement>(null);
  const { status, user, logout } = useAuth();
  const selectedKey = resolveSelectedKey(location.pathname);
  const visibleSystemNavigation = useMemo(
    () =>
      user?.isAdmin
        ? systemNavigation
        : systemNavigation.filter((item) => item.key !== "audit"),
    [user?.isAdmin],
  );
  const catalogScope = useMemo(
    () => readCatalogScope(location.pathname),
    [location.pathname],
  );
  const treeScope = useMemo(() => treeScopeOf(catalogScope), [catalogScope]);
  const sectionLabel = resolveSectionLabel(location.pathname);
  const displayName = user?.name.trim() || "访客";
  const avatarText = user?.name.trim().charAt(0) || "访";
  const roleLabel = user?.isAdmin ? "系统管理员" : user ? "成员" : "未登录";
  const popoverRoleLabel = user?.isAdmin
    ? "系统管理员 · 可执行高风险操作"
    : roleLabel;
  const trail = useCatalogTrail({
    projectId: catalogScope.projectId,
    moduleId: catalogScope.moduleId,
    featureId: catalogScope.featureId,
    client: projectClient,
    enabled: status === "authenticated",
  });
  const shellCounters = useShellCounters({
    client: projectClient,
    enabled: status === "authenticated",
  });
  const projectCrumbName = trail.projectName;
  const shellCounts: Readonly<Record<string, number>> = useMemo(
    () => ({
      tasks: shellCounters.myOpenTaskCount ?? 0,
      issues: shellCounters.openLeftoverCount ?? 0,
    }),
    [shellCounters.myOpenTaskCount, shellCounters.openLeftoverCount],
  );
  // 设计师稿只在「项目与功能」视图渲染 项目 → 模块 → 功能 三段面包屑。
  const isCatalogView = resolveSection(location.pathname)?.key === "projects";
  const catalogProjectId = isCatalogView ? catalogScope.projectId : null;
  const moduleCrumbName = isCatalogView ? trail.moduleName : null;
  const featureCrumbName = isCatalogView ? trail.featureName : null;

  useEffect(() => {
    if (resolveSelectedKey(location.pathname) === "projects") {
      setCatalogOpen(true);
    }
  }, [location.pathname]);

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
      navigate("/login");
      return;
    }
    setIsLoggingOut(true);
    try {
      const loggedOut = await logout()
        .then(() => true)
        .catch(() => false);
      if (loggedOut) {
        navigate("/login");
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  const renderNavigationItem = (item: NavigationItem) => {
    const count = shellCounts[item.key] ?? 0;
    const withCatalog = item.key === "projects";
    const button = (
      <button
        type="button"
        className={`nav-item${selectedKey === item.key ? " active" : ""}`}
        aria-current={selectedKey === item.key ? "page" : undefined}
        onClick={() => handleNavigation(item.path)}
      >
        <InpulseIcon name={item.icon} size={17} />
        <span>{item.label}</span>
        {count > 0 ? (
          <em aria-hidden="true" title={`${count} 项待处理`}>
            {count}
          </em>
        ) : null}
      </button>
    );
    if (!withCatalog) {
      return <React.Fragment key={item.key}>{button}</React.Fragment>;
    }
    // 系统目录内嵌在「项目与功能」下：chevron 切换按钮与导航按钮平级，避免嵌套 button。
    return (
      <div key={item.key} className="nav-item-group">
        <div className="nav-item-row">
          {button}
          <button
            type="button"
            className="nav-tree-toggle"
            aria-label={catalogOpen ? "收起系统目录" : "展开系统目录"}
            aria-expanded={catalogOpen}
            onClick={() => setCatalogOpen((current) => !current)}
          >
            <InpulseIcon
              name="chevron"
              size={14}
              className={catalogOpen ? "tree-chevron expanded" : "tree-chevron"}
            />
          </button>
        </div>
        {catalogOpen ? (
          <ProjectTree
            activeScope={treeScope}
            onNavigate={handleNavigation}
            {...(projectClient ? { client: projectClient } : {})}
          />
        ) : null}
      </div>
    );
  };

  if (location.pathname === "/login") {
    // 登录页使用独立的全屏视觉，不渲染工作台外壳。
    return <Outlet />;
  }

  return (
    <>
      <div className="app-shell">
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
          <button
            type="button"
            className="workspace"
            onClick={() => handleNavigation("/tasks")}
          >
            <span className="workspace-dot" />
            <span>研发交付中心</span>
          </button>
          <nav className="nav-group" aria-label="工作区导航">
            <p>工作区</p>
            {workspaceNavigation.map(renderNavigationItem)}
            <p className="nav-section">系统</p>
            {visibleSystemNavigation.map(renderNavigationItem)}
          </nav>
          <div className="sidebar-footer">
            <span className="person-avatar">{avatarText}</span>
            <div className="account-identity">
              <strong>{displayName}</strong>
              <small>{roleLabel}</small>
            </div>
            <button
              type="button"
              className="text-button"
              onClick={() => handleNavigation("/settings")}
            >
              <InpulseIcon name="shield" size={14} />
              查看权限矩阵
            </button>
          </div>
        </aside>

        <main className="content-shell">
          <header className="topbar">
            <button
              type="button"
              className="icon-button menu-button"
              aria-label={mobileNavOpen ? "关闭导航" : "打开导航"}
              aria-expanded={mobileNavOpen}
              onClick={() => setMobileNavOpen((current) => !current)}
            >
              <InpulseIcon name="menu" size={20} />
            </button>
            <nav className="crumb" aria-label="面包屑导航">
              <button
                type="button"
                className="crumb-home"
                onClick={() => handleNavigation("/tasks")}
              >
                研发交付中心
              </button>
              <InpulseIcon name="chevron" size={14} />
              {catalogProjectId !== null && projectCrumbName ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleNavigation("/projects")}
                  >
                    项目与功能
                  </button>
                  <InpulseIcon name="chevron" size={14} />
                  {moduleCrumbName ? (
                    <>
                      <button
                        type="button"
                        title={projectCrumbName}
                        onClick={() =>
                          handleNavigation(
                            `/projects/${catalogProjectId}/overview`,
                          )
                        }
                      >
                        {projectCrumbName}
                      </button>
                      <InpulseIcon name="chevron" size={14} />
                    </>
                  ) : (
                    <strong aria-current="page" title={projectCrumbName}>
                      {projectCrumbName}
                    </strong>
                  )}
                  {moduleCrumbName ? (
                    featureCrumbName ? (
                      <>
                        <button
                          type="button"
                          title={moduleCrumbName}
                          onClick={() =>
                            handleNavigation(
                              `/projects/${catalogProjectId}/modules/${catalogScope.moduleId}`,
                            )
                          }
                        >
                          {moduleCrumbName}
                        </button>
                        <InpulseIcon name="chevron" size={14} />
                        <strong aria-current="page" title={featureCrumbName}>
                          {featureCrumbName}
                        </strong>
                      </>
                    ) : (
                      <strong aria-current="page" title={moduleCrumbName}>
                        {moduleCrumbName}
                      </strong>
                    )
                  ) : null}
                </>
              ) : projectCrumbName ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      handleNavigation(
                        selectedKey === "activity" ? "/activity" : "/projects",
                      )
                    }
                  >
                    {sectionLabel}
                  </button>
                  <InpulseIcon name="chevron" size={14} />
                  <strong aria-current="page" title={projectCrumbName}>
                    {projectCrumbName}
                  </strong>
                </>
              ) : (
                <strong aria-current="page">{sectionLabel}</strong>
              )}
            </nav>
            <div className="top-actions">
              <button
                type="button"
                className="global-search"
                aria-label="打开全局搜索"
                onClick={() => setPaletteOpen(true)}
              >
                <InpulseIcon name="search" size={16} />
                <span>搜索项目、功能、任务、迭代记录…</span>
                <kbd>Ctrl K</kbd>
              </button>
              <NotificationBell
                client={notificationClient}
                enabled={status === "authenticated"}
                onOpen={() => handleNavigation("/notifications")}
                onOpenTarget={handleOpenTarget}
              />
              <div className="popover-wrap" ref={accountRootRef}>
                <button
                  type="button"
                  className="mini-avatar account-trigger"
                  title={`${displayName} · ${popoverRoleLabel}`}
                  aria-label="账户菜单"
                  aria-expanded={accountOpen}
                  onClick={() => setAccountOpen((current) => !current)}
                >
                  {avatarText}
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
                    {user?.isAdmin ? (
                      <button
                        type="button"
                        onClick={() => {
                          setAccountOpen(false);
                          setReauthOpen(true);
                        }}
                      >
                        <InpulseIcon name="shield" size={15} />
                        管理员安全验证
                      </button>
                    ) : null}
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
            </div>
          </header>
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
      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
      />
    </>
  );
};
