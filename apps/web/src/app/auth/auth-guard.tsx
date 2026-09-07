import React from "react";
import { Spin, Result, Button } from "antd";
import { useAuth } from "./auth-context";

export interface RequireAuthProps {
  readonly children: React.ReactElement;
  readonly fallback?: React.ReactElement;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({
  children,
  fallback
}) => {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div data-testid="auth-loading" style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" description="正在验证身份..." />
      </div>
    );
  }

  if (status === "anonymous") {
    if (fallback) {
      return fallback;
    }
    return (
      <div data-testid="auth-anonymous" style={{ padding: 48 }}>
        <Result
          status="403"
          title="需要登录"
          subTitle="访问此页面需要先登录系统。"
          extra={<Button type="primary" href="/login">前往登录</Button>}
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
  fallback
}) => {
  const { status, user } = useAuth();

  if (status === "loading") {
    return (
      <div data-testid="admin-loading" style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" description="正在验证权限..." />
      </div>
    );
  }

  if (status !== "authenticated" || !user?.isSystemAdmin) {
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
