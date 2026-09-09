import React, { useEffect, useState } from "react";
import { Avatar, Button, Input, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { NotificationBell } from "@features/notifications/NotificationBell";

const { Text } = Typography;

const navigationItems = [
  { key: "home", label: "工作台", icon: "⌂" },
  { key: "search", label: "全局搜索", icon: "⌕" },
  { key: "projects", label: "项目与功能", icon: "▣" },
  { key: "tasks", label: "我的任务", icon: "✓" },
  { key: "records", label: "迭代记录", icon: "≣" },
  { key: "settings", label: "成员与权限", icon: "⚙" },
  { key: "audit", label: "动态审计", icon: "◉" },
] as const;

const navigationPaths: Readonly<Record<string, string>> = {
  home: "/",
  search: "/search",
  projects: "/projects",
  tasks: "/tasks",
  records: "/records",
  settings: "/settings",
  audit: "/audit",
};

const sections = [
  { prefix: "/search", key: "search", label: "全局搜索" },
  { prefix: "/notifications", key: "notifications", label: "站内通知" },
  { prefix: "/projects", key: "projects", label: "项目与功能" },
  { prefix: "/tasks", key: "tasks", label: "我的任务" },
  { prefix: "/records", key: "records", label: "迭代记录" },
  { prefix: "/settings", key: "settings", label: "成员与权限" },
  { prefix: "/audit", key: "audit", label: "动态审计" },
] as const;

function resolveSection(pathname: string) {
  if (/^\/projects\/[^/]+\/activity(?:\/|$)/.test(pathname)) {
    return { key: "project-activity", label: "项目动态" };
  }
  return sections.find((section) => pathname.startsWith(section.prefix));
}

function resolveSelectedKey(pathname: string): string {
  const section = resolveSection(pathname);
  return section?.key === "project-activity"
    ? "projects"
    : (section?.key ?? "home");
}

function resolveSectionLabel(pathname: string): string {
  return resolveSection(pathname)?.label ?? "工作台";
}

export interface AppLayoutProps {
  readonly notificationClient?: InpulseApiClient;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ notificationClient }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchDraft, setSearchDraft] = useState("");
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { status, user, logout } = useAuth();
  const selectedKey = resolveSelectedKey(location.pathname);
  const sectionLabel = resolveSectionLabel(location.pathname);
  const displayName = user?.name.trim() || "访客";
  const avatarText = user?.name.trim().charAt(0) || "访";

  useEffect(() => {
    if (location.pathname === "/search") {
      setSearchDraft(new URLSearchParams(location.search).get("q") ?? "");
      return;
    }
    setSearchDraft("");
  }, [location.pathname, location.search]);

  const handleNavigation = ({ key }: { key: string }) => {
    const target = navigationPaths[key];
    if (target && target !== location.pathname) {
      navigate(target);
    }
  };

  const handleSearch = (value: string) => {
    const query = value.trim();
    setSearchDraft(query);
    navigate(
      query
        ? "/search?" + new URLSearchParams({ q: query }).toString()
        : "/search",
    );
  };

  const handleAccountAction = async () => {
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
        navigate("/");
      }
    } finally {
      setIsLoggingOut(false);
    }
  };

  const statusLabel =
    status === "loading"
      ? "正在验证..."
      : status === "error"
        ? "登录状态异常"
        : status === "authenticated"
          ? "已登录"
          : "未登录";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">in</div>
          <div>
            <strong>InPulse</strong>
            <small>研发交付中心</small>
          </div>
        </div>
        <div className="workspace">
          <span className="workspace-dot" />
          <span>研发交付中心</span>
          <span className="workspace-caret" aria-hidden="true">
            ⌄
          </span>
        </div>
        <nav className="nav-group" aria-label="工作区导航">
          <span className="nav-group-label">工作区</span>
          {navigationItems
            .filter((item) => item.key !== "settings" && item.key !== "audit")
            .map((item) => (
              <button
                type="button"
                key={item.key}
                className={`nav-item${selectedKey === item.key ? " active" : ""}`}
                aria-current={selectedKey === item.key ? "page" : undefined}
                onClick={() => handleNavigation({ key: item.key })}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="nav-item-label">{item.label}</span>
              </button>
            ))}
          <span className="nav-section-label">系统</span>
          {navigationItems
            .filter((item) => item.key === "settings" || item.key === "audit")
            .map((item) => (
              <button
                type="button"
                key={item.key}
                className={`nav-item${selectedKey === item.key ? " active" : ""}`}
                aria-current={selectedKey === item.key ? "page" : undefined}
                onClick={() => handleNavigation({ key: item.key })}
              >
                <span className="nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="nav-item-label">{item.label}</span>
              </button>
            ))}
        </nav>
        <div className="sidebar-footer">
          <Avatar className="user-avatar">{avatarText}</Avatar>
          <div className="sidebar-user">
            <strong>{displayName}</strong>
            <small>{statusLabel}</small>
          </div>
          <Button
            type="text"
            className="logout-button"
            aria-label={status === "authenticated" ? "退出登录" : "登录"}
            loading={isLoggingOut}
            onClick={() => void handleAccountAction()}
          >
            {status === "authenticated" ? "退出" : "登录"}
          </Button>
        </div>
      </aside>

      <main className="content-shell">
        <header className="topbar">
          <nav className="crumb" aria-label="面包屑导航">
            <button
              type="button"
              className="crumb-home"
              onClick={() => navigate("/")}
            >
              研发交付中心
            </button>
            <span className="crumb-separator" aria-hidden="true">
              /
            </span>
            <Text strong>{sectionLabel}</Text>
          </nav>
          <div className="top-actions">
            <Input.Search
              className="global-search"
              aria-label="全局搜索"
              allowClear
              enterButton="搜索"
              placeholder="搜索项目、任务、功能..."
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.currentTarget.value)}
              onSearch={handleSearch}
              style={{ width: 292, height: 36 }}
            />
            <NotificationBell
              client={notificationClient}
              enabled={status === "authenticated"}
              onOpen={() => navigate("/notifications")}
            />
            <Avatar className="mini-avatar" aria-label={displayName}>
              {avatarText}
            </Avatar>
          </div>
        </header>
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
