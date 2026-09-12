import React, { useState } from "react";
import { Alert, Button, Checkbox, Form, Input } from "antd";
import type { LoginRequest } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { describeLoginError } from "./auth-errors";
import { useAuth } from "./auth-context";
import { MfaChallengeForm } from "./MfaChallengeForm";
import { MfaEnrollmentForm } from "./MfaEnrollmentForm";
import { MfaRecoveryForm } from "./MfaRecoveryForm";

interface LoginFormValues {
  readonly loginName: string;
  readonly password: string;
}

export type LoginFormVariant = "default" | "brand";

export interface LoginFormProps {
  readonly onAuthenticated?: () => void;
  /**
   * default: 工作台内嵌的表单样式（保留可见标签）。
   * brand: 登录页设计稿样式（药丸输入框 + 图标前缀 + 黄色主按钮）。
   */
  readonly variant?: LoginFormVariant;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  onAuthenticated,
  variant = "default",
}) => {
  const { login, logout, mfaState, pendingRecoveryCodes } = useAuth();
  const [challengeMode, setChallengeMode] = useState<"totp" | "recovery">(
    "totp",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isBrand = variant === "brand";

  const handleFinish = async (values: LoginFormValues) => {
    const credentials: LoginRequest = {
      loginName: values.loginName.trim(),
      password: values.password,
      challengeMode,
    };
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await login(credentials);
      if (result.kind === "authenticated") {
        onAuthenticated?.();
      }
    } catch (error) {
      setErrorMessage(describeLoginError(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSwitchMode = async (mode: "totp" | "recovery") => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await logout();
      setChallengeMode(mode);
    } catch (error) {
      setErrorMessage(describeLoginError(error));
    } finally {
      setSubmitting(false);
    }
  };

  if (mfaState === "MFA_ENROLLMENT" || pendingRecoveryCodes !== null) {
    return <MfaEnrollmentForm onAuthenticated={onAuthenticated} />;
  }
  if (mfaState === "MFA_CHALLENGE") {
    return (
      <MfaChallengeForm
        onAuthenticated={onAuthenticated}
        onUseRecovery={() => void handleSwitchMode("recovery")}
      />
    );
  }
  if (mfaState === "RECOVERY_CHALLENGE") {
    return (
      <MfaRecoveryForm
        onAuthenticated={onAuthenticated}
        onUseTotp={() => void handleSwitchMode("totp")}
      />
    );
  }

  return (
    <Form<LoginFormValues>
      layout="vertical"
      requiredMark={false}
      onFinish={handleFinish}
      className={isBrand ? "login-form login-form-brand" : "login-form"}
    >
      <Form.Item
        label={isBrand ? undefined : "登录名"}
        name="loginName"
        rules={[
          { required: true, message: "请输入登录名" },
          { max: 100, message: "登录名不能超过 100 个字符" },
        ]}
      >
        <Input
          aria-label="登录名"
          autoComplete="username"
          placeholder="请输入登录名"
          maxLength={100}
          disabled={submitting}
          size={isBrand ? "large" : "middle"}
          {...(isBrand
            ? {
                prefix: (
                  <InpulseIcon
                    name="user"
                    size={18}
                    className="login-input-icon"
                  />
                ),
              }
            : {})}
        />
      </Form.Item>
      <Form.Item
        label={isBrand ? undefined : "密码"}
        name="password"
        rules={[{ required: true, message: "请输入密码" }]}
      >
        <Input.Password
          aria-label="密码"
          autoComplete="current-password"
          placeholder="请输入密码"
          disabled={submitting}
          size={isBrand ? "large" : "middle"}
          {...(isBrand
            ? {
                prefix: (
                  <InpulseIcon
                    name="lock"
                    size={18}
                    className="login-input-icon"
                  />
                ),
              }
            : {})}
        />
      </Form.Item>
      <Form.Item style={isBrand ? { marginBottom: 0 } : { marginBottom: 16 }}>
        <Checkbox
          checked={challengeMode === "recovery"}
          onChange={(event) =>
            setChallengeMode(event.target.checked ? "recovery" : "totp")
          }
          disabled={submitting}
        >
          使用恢复码登录（无法访问验证器时可选）
        </Checkbox>
      </Form.Item>
      {errorMessage ? (
        <Alert showIcon type="error" message={errorMessage} />
      ) : null}
      <Button
        type="primary"
        htmlType="submit"
        block
        loading={submitting}
        size={isBrand ? "large" : "middle"}
        {...(isBrand ? { className: "login-submit" } : {})}
        style={{ marginTop: isBrand ? 4 : 16 }}
      >
        登录
      </Button>
    </Form>
  );
};

export default LoginForm;
