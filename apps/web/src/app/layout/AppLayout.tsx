import React, { useEffect, useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Input,
  Layout,
  Menu,
  Typography,
  type MenuProps,
} from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@features/auth/auth-context";

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const workspaceMenuItems: MenuProps["items"] = [
  { key: "home", label: "工作台" },
  { key: "search", label: "全局搜索" },
  { key: "projects", label: "项目与功能" },
  { key: "tasks", label: "我的任务" },
  { key: "records", label: "迭代记录" },
  {
    type: "group",
    label: "管理",
    children: [
      { key: "settings", label: "成员与权限" },
      { key: "audit", label: "动态审计" },
    ],
  },
];

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
  { prefix: "/projects", key: "projects", label: "项目与功能" },
  { prefix: "/tasks", key: "tasks", label: "我的任务" },
  { prefix: "/records", key: "records", label: "迭代记录" },
  { prefix: "/settings", key: "settings", label: "成员与权限" },
  { prefix: "/audit", key: "audit", label: "动态审计" },
] as const;

function resolveSection(pathname: string) {
  return sections.find((section) => pathname.startsWith(section.prefix));
}

function resolveSelectedKey(pathname: string): string {
  return resolveSection(pathname)?.key ?? "home";
}

function resolveSectionLabel(pathname: string): string {
  return resolveSection(pathname)?.label ?? "工作台";
}

export const AppLayout: React.FC = () => {
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

  return (
    <Layout style={{ minHeight: "100vh", background: "#f5f7fb" }}>
      <Sider
        width={248}
        theme="dark"
        style={{ background: "#10253e", minHeight: "100vh" }}
      >
        <div
          style={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "20px 13px 14px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "2px 10px 23px",
              color: "#fff",
            }}
          >
            <div
              style={{
                width: 35,
                height: 35,
                display: "grid",
                placeItems: "center",
                borderRadius: 10,
                color: "#fff",
                background: "#2d91d8",
                fontWeight: 800,
                letterSpacing: -1,
              }}
            >
              in
            </div>
            <div>
              <Text strong style={{ display: "block", fontSize: 16 }}>
                InPulse
              </Text>
              <Text
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "#8099b2",
                  fontSize: 10,
                  letterSpacing: 0.4,
                }}
              >
                研发知识与交付
              </Text>
            </div>
          </div>

          <div
            style={{
              height: 38,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 11px",
              margin: "0 2px 25px",
              border: "1px solid #29445f",
              borderRadius: 7,
              color: "#d1ddeb",
              background: "#19344e",
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#39d1ba",
                boxShadow: "0 0 0 3px #39d1ba18",
              }}
            />
            <span>研发交付中心</span>
            <span
              style={{ marginLeft: "auto", color: "#7892aa" }}
              aria-hidden="true"
            >
              ⌄
            </span>
          </div>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selectedKey]}
            items={workspaceMenuItems}
            onClick={handleNavigation}
            style={{
              flex: 1,
              background: "transparent",
              borderInlineEnd: "none",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "17px 8px 3px",
              marginTop: 18,
              borderTop: "1px solid #2a435c",
            }}
          >
            <Avatar
              style={{
                flex: "0 0 30px",
                color: "#d8eaf8",
                background: "#286887",
              }}
            >
              {avatarText}
            </Avatar>
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text
                strong
                style={{ display: "block", color: "#f4f8fb", fontSize: 12 }}
              >
                {displayName}
              </Text>
              <Text
                style={{
                  display: "block",
                  marginTop: 4,
                  color: "#7894ad",
                  fontSize: 10,
                }}
              >
                {status === "loading"
                  ? "正在验证..."
                  : status === "error"
                    ? "登录状态异常"
                    : status === "authenticated"
                      ? "已登录"
                      : "未登录"}
              </Text>
            </div>
            <Button
              type="text"
              aria-label={status === "authenticated" ? "退出登录" : "登录"}
              loading={isLoggingOut}
              onClick={() => void handleAccountAction()}
              style={{
                minWidth: 0,
                height: "auto",
                padding: 0,
                color: "#7190aa",
                fontSize: 11,
              }}
            >
              {status === "authenticated" ? "退出" : "登录"}
            </Button>
          </div>
        </div>
      </Sider>

      <Layout
        style={{ minWidth: 0, minHeight: "100vh", background: "#f5f7fb" }}
      >
        <Header
          style={{
            height: 68,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            padding: "0 38px",
            borderBottom: "1px solid #e4eaf1",
            background: "#fff",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 9,
              minWidth: 0,
            }}
          >
            <Text type="secondary">研发交付中心</Text>
            <Text type="secondary" aria-hidden="true">
              /
            </Text>
            <Text strong>{sectionLabel}</Text>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 17 }}>
            <Input.Search
              aria-label="全局搜索"
              allowClear
              enterButton="搜索"
              placeholder="搜索项目、任务、功能..."
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.currentTarget.value)}
              onSearch={handleSearch}
              style={{
                width: 292,
                height: 36,
                background: "#f8fafc",
                border: "1px solid #e9eef3",
                borderRadius: 7,
              }}
            />
            <Badge dot color="#ef7777" offset={[-4, 4]}>
              <Button
                type="text"
                aria-label="通知"
                style={{ minWidth: 30, minHeight: 30, color: "#718399" }}
              >
                通知
              </Button>
            </Badge>
            <Avatar style={{ color: "#2364aa", background: "#dcecff" }}>
              {avatarText}
            </Avatar>
          </div>
        </Header>

        <Content
          style={{
            width: "100%",
            maxWidth: 1500,
            padding: "39px 42px 64px",
            margin: "0 auto",
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
};
