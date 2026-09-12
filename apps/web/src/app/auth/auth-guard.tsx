import React from "react";
import { Spin, Result, Button } from "antd";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@features/auth/auth-context";

export interface RequireAuthProps {
  readonly children: React.ReactElement;
  readonly fallback?: React.ReactElement;
}

export function buildLoginRedirect(pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.startsWith("/login")
  ) {
    return "/login";
  }
  return `/login?${new URLSearchParams({ from: target }).toString()}`;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({
  children,
  fallback,
}) => {
  const { status, errorMessage } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div
        data-testid="auth-loading"
        style={{ display: "flex", justifyContent: "center", padding: 48 }}
      >
        <Spin size="large" description="正在验证身份..." />
      </div>
    );
  }

  if (status === "anonymous") {
    if (fallback) {
      return fallback;
    }
    return (
      <Navigate
        to={buildLoginRedirect(location.pathname, location.search)}
        replace
      />
    );
  }

  if (status === "error") {
    if (fallback) {
      return fallback;
    }
    return (
      <div data-testid="auth-anonymous" style={{ padding: 48 }}>
        <Result
          status="500"
          title="登录状态异常"
          subTitle={errorMessage ?? "无法确认登录状态，请刷新页面后重试。"}
          extra={
            <Button type="primary" href="/login">
              重新登录
            </Button>
          }
        />
      </div>
    );
  }

  return children;
};

export interface RequireAdminProps {
  readonly children: React.ReactElement;
  readonly fallback?: React.ReactElement;
}

export const RequireAdmin: React.FC<RequireAdminProps> = ({
  children,
  fallback,
}) => {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <div
        data-testid="admin-loading"
        style={{ display: "flex", justifyContent: "center", padding: 48 }}
      >
        <Spin size="large" description="正在验证权限..." />
      </div>
    );
  }

  if (status !== "authenticated" || !user?.isAdmin) {
    if (fallback) {
      return fallback;
    }
    return (
      <div data-testid="admin-forbidden" style={{ padding: 48 }}>
        <Result
          status="403"
          title="无权访问"
          subTitle="此区域仅限系统管理员访问。"
        />
      </div>
    );
  }

  return children;
};
