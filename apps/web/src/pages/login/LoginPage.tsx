import React, { useEffect, useRef } from "react";
import { Alert, Button, Spin } from "antd";
import { useLocation, useNavigate } from "react-router-dom";
import { LoginForm } from "@features/auth/LoginForm";
import { useAuth } from "@features/auth/auth-context";
import {
  describeSsoError,
  navigateToSsoStart,
} from "@features/auth/sso-navigation";
import "./login-page.css";

export function resolveLoginTarget(rawTarget: string | null): string {
  if (
    rawTarget?.startsWith("/") &&
    !rawTarget.startsWith("//") &&
    !rawTarget.startsWith("/login")
  ) {
    return rawTarget;
  }
  return "/";
}

/**
 * 登录页（ADR-032）：默认整页跳转到立镖 Casdoor 单点登录；`?local=1` 保留
 * 本地口令应急入口。单点登录未配置时服务端会回落到
 * `/login?local=1&sso=disabled`，登录失败时回落 `/login?sso_error=...`。
 */
export const LoginPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, errorMessage } = useAuth();

  const params = new URLSearchParams(location.search);
  // 跳转成功后 `from` 会从地址栏消失；固定首次渲染解析出的目标，
  // 避免目标漂移成默认值并触发重复跳转。
  const targetRef = useRef(resolveLoginTarget(params.get("from")));
  const target = targetRef.current;
  const ssoDisabled = params.get("sso") === "disabled";
  const showLocalForm = params.get("local") === "1" || ssoDisabled;
  const ssoErrorMessage = describeSsoError(params.get("sso_error"));
  const showSsoPending =
    !showLocalForm && ssoErrorMessage === null && status !== "error";

  useEffect(() => {
    if (status === "authenticated") {
      navigate(target, { replace: true });
      return;
    }
    // 登录失败（sso_error）与本地入口不自动跳转，避免与回调互相打转。
    if (!showSsoPending || status !== "anonymous") {
      return;
    }
    navigateToSsoStart(target);
  }, [navigate, showSsoPending, status, target]);

  const handleAuthenticated = () => {
    navigate(target, { replace: true });
  };

  const startSsoLogin = () => {
    navigateToSsoStart(target);
  };

  const renderBody = () => {
    if (showSsoPending) {
      return (
        <div className="login-sso-pending" data-testid="login-sso-redirecting">
          <Spin size="large" />
          <p className="login-sso-status">
            {status === "loading"
              ? "正在检查登录状态…"
              : "正在跳转到统一身份认证…"}
          </p>
          <Button
            type="primary"
            block
            size="large"
            className="login-submit"
            onClick={startSsoLogin}
          >
            前往统一身份认证
          </Button>
        </div>
      );
    }

    if (ssoErrorMessage !== null) {
      return (
        <div className="login-sso-failed" data-testid="login-sso-failed">
          <Alert showIcon type="error" message={ssoErrorMessage} />
          <Button
            type="primary"
            block
            size="large"
            className="login-submit"
            onClick={startSsoLogin}
          >
            重新使用统一身份认证登录
          </Button>
        </div>
      );
    }

    return (
      <>
        {ssoDisabled ? (
          <Alert
            showIcon
            type="info"
            message="统一身份认证未启用，已切换到本地账号登录。"
          />
        ) : null}
        {status === "error" ? (
          <Alert
            showIcon
            type="error"
            message={errorMessage ?? "无法确认登录状态，请刷新页面后重试。"}
          />
        ) : null}
        <LoginForm variant="brand" onAuthenticated={handleAuthenticated} />
        {ssoDisabled ? null : (
          <div className="login-sso-switch">
            <Button type="link" onClick={startSsoLogin}>
              使用统一身份认证登录
            </Button>
          </div>
        )}
      </>
    );
  };

  return (
    <main className="login-page" data-testid="login-page">
      <section className="login-card">
        <div className="login-card-slashes" aria-hidden="true">
          <span />
          <span />
        </div>
        <img
          className="login-logo"
          src="/libiao-robotics-logo.png"
          alt="Libiao Robotics"
        />
        <h1 className="login-title">登录 InPulse</h1>
        {renderBody()}
        <div className="login-card-footer" aria-hidden="true">
          <span className="login-card-brand">INPULSE</span>
          <span className="login-card-divider" />
          <span className="login-card-stripes">
            <i />
            <i />
          </span>
        </div>
      </section>
    </main>
  );
};

export default LoginPage;
