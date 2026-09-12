import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { LoginForm } from "@features/auth/LoginForm";
import { useAuth } from "@features/auth/auth-context";
import "./login-page.css";

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
    <main className="login-page" data-testid="login-page">
      <div className="login-watermark" aria-hidden="true">
        INPULSE
      </div>
      <div className="login-decor login-decor-top" aria-hidden="true">
        <span className="login-decor-bar" />
        <span className="login-decor-bar" />
        <span className="login-decor-bar login-decor-bar-thin" />
      </div>
      <div className="login-decor login-decor-chevron" aria-hidden="true" />
      <div className="login-decor login-decor-bottom" aria-hidden="true">
        <span className="login-decor-bar" />
        <span className="login-decor-bar" />
      </div>

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
        <LoginForm variant="brand" onAuthenticated={handleAuthenticated} />
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
