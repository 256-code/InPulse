import React, { useEffect } from "react";
import { Card, Space, Typography } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { LoginForm } from "@features/auth/LoginForm";
import { useAuth } from "@features/auth/auth-context";

const { Paragraph, Title } = Typography;

function resolveLoginTarget(rawTarget: string | null): string {
  if (
    rawTarget?.startsWith("/") &&
    !rawTarget.startsWith("//") &&
    !rawTarget.startsWith("/login")
  ) {
    return rawTarget;
  }
  return "/";
}

export const LoginPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, pendingRecoveryCodes } = useAuth();
  const target = resolveLoginTarget(
    new URLSearchParams(location.search).get("from"),
  );

  useEffect(() => {
    if (status === "authenticated" && pendingRecoveryCodes === null) {
      navigate(target, { replace: true });
    }
  }, [navigate, pendingRecoveryCodes, status, target]);

  const handleAuthenticated = () => {
    navigate(target, { replace: true });
  };

  return (
    <Space direction="vertical" size={20} style={{ width: "100%" }}>
      <Card style={{ maxWidth: 480, margin: "0 auto", borderRadius: 10 }}>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Title level={3} style={{ margin: 0 }}>
            登录 InPulse
          </Title>
          <Paragraph type="secondary" style={{ margin: 0 }}>
            使用系统账号登录后，可继续访问全局搜索等项目数据。
          </Paragraph>
          <LoginForm onAuthenticated={handleAuthenticated} />
        </Space>
      </Card>
    </Space>
  );
};

export default LoginPage;
