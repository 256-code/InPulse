import React, { useEffect, useRef } from "react";
import { Alert, Divider } from "antd";
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
 * 登录页（ADR-036）：默认展示既有本地口令表单，登录框下方提供
 * 「或以统一身份认证登录」图标入口（单点登录系统图标素材），点击后整页跳转到
 * `/api/v1/auth/sso/start`（浏览器导航而非 XHR）。`?local=1` 与默认渲染
 * 一致，仅用于兼容服务端回落地址；SSO 未启用时服务端回落
 * `/login?local=1&sso=disabled` 并提示，登录失败时回落
 * `/login?sso_error=...`，两种情况都保留本地口令入口。
 */
export const LoginPage: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { status, errorMessage } = useAuth();

  const params = new URLSearchParams(location.search);
  // 跳转成功后 `from` 会从地址栏消失；固定首次渲染解析出的目标，
  // 避免目标漂移成默认值。
  const targetRef = useRef(resolveLoginTarget(params.get("from")));
  const target = targetRef.current;
  const ssoDisabled = params.get("sso") === "disabled";
  const ssoErrorMessage = describeSsoError(params.get("sso_error"));

  useEffect(() => {
    if (status === "authenticated") {
      navigate(target, { replace: true });
    }
  }, [navigate, status, target]);

  const handleAuthenticated = () => {
    navigate(target, { replace: true });
  };

  const startSsoLogin = () => {
    navigateToSsoStart(target);
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
        {ssoDisabled ? (
          <Alert
            showIcon
            type="info"
            message="统一身份认证未启用，已切换到本地账号登录。"
          />
        ) : null}
        {ssoErrorMessage !== null ? (
          <Alert showIcon type="error" message={ssoErrorMessage} />
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
          <div className="login-sso-section">
            <Divider plain className="login-sso-divider">
              或以统一身份认证登录
            </Divider>
            <button
              type="button"
              className="login-sso-icon-button"
              aria-label="使用统一身份认证登录"
              title="使用统一身份认证登录"
              onClick={startSsoLogin}
            >
              <img
                className="login-sso-icon-image"
                src="/casdoor-logo.png"
                alt=""
                aria-hidden="true"
              />
            </button>
          </div>
        )}
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
