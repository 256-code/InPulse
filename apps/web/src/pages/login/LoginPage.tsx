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
 * 登录页（ADR-080）：匿名访问 `/login`（含 `?from=`）立即整页跳转
 * `/api/v1/auth/sso/start`（浏览器导航而非 XHR），登录页呈现的直接就是
 * 统一身份认证，跳转期间展示品牌加载态；仅 `?local=1`（管理员应急）与
 * 服务端 fail closed 回落的 `?sso=disabled` 分支渲染本地口令表单且不自动
 * 跳转，`?sso_error=` 回落只显示错误与手动重试，避免与回调互相打转。
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
  const localEntry = params.get("local") === "1";
  const ssoDisabled = params.get("sso") === "disabled";
  const ssoErrorMessage = describeSsoError(params.get("sso_error"));
  const showLocalForm = localEntry || ssoDisabled;
  // 登录页呈现的直接就是统一身份认证：只有本地应急入口与错误回落
  // 两类地址不自动发起 SSO，避免与 302 回落互相打转。
  const autoStartSso =
    status === "anonymous" && !showLocalForm && ssoErrorMessage === null;

  const autoStartRequestedRef = useRef(false);
  useEffect(() => {
    if (status === "authenticated") {
      navigate(target, { replace: true });
      return;
    }
    if (!autoStartSso || autoStartRequestedRef.current) {
      return;
    }
    autoStartRequestedRef.current = true;
    navigateToSsoStart(target);
  }, [autoStartSso, navigate, status, target]);

  const handleAuthenticated = () => {
    navigate(target, { replace: true });
  };

  const startSsoLogin = () => {
    navigateToSsoStart(target);
  };

  const transitionMessage =
    status === "loading"
      ? "正在确认登录状态…"
      : status === "authenticated"
        ? "已登录，正在跳转…"
        : autoStartSso
          ? "正在跳转到统一身份认证…"
          : null;

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
          width={560}
          height={226}
        />
        <h1 className="login-title">登录 InPulse</h1>
        {transitionMessage !== null ? (
          <div className="login-transition" data-testid="login-transition">
            <Spin size="large" />
            <p className="login-transition-text">{transitionMessage}</p>
          </div>
        ) : (
          <>
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
            {showLocalForm ? (
              <LoginForm
                variant="brand"
                onAuthenticated={handleAuthenticated}
              />
            ) : (
              <Button type="primary" block size="large" onClick={startSsoLogin}>
                重新登录
              </Button>
            )}
          </>
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
