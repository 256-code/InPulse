import React, { useState } from "react";
import { Alert, Button, Form, Input } from "antd";
import type { LoginRequest } from "@generated/api";
import { describeLoginError } from "./auth-errors";
import { useAuth, type MfaAuthState } from "./auth-context";

interface LoginFormValues {
  readonly loginName: string;
  readonly password: string;
}

const mfaMessages: Readonly<Record<MfaAuthState, string>> = {
  MFA_ENROLLMENT: "该账号需要先注册 TOTP MFA，当前版本尚未接入。",
  MFA_CHALLENGE: "该账号需要完成 TOTP MFA 验证，当前版本尚未接入。",
  RECOVERY_CHALLENGE: "该账号需要完成恢复码验证，当前版本尚未接入。",
};

export interface LoginFormProps {
  readonly onAuthenticated?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onAuthenticated }) => {
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<string | null>(null);

  const handleFinish = async (values: LoginFormValues) => {
    const credentials: LoginRequest = {
      loginName: values.loginName.trim(),
      password: values.password,
    };
    setSubmitting(true);
    setErrorMessage(null);
    setMfaMessage(null);
    try {
      const result = await login(credentials);
      if (result.kind === "authenticated") {
        onAuthenticated?.();
      } else if (result.kind === "mfa-required") {
        setMfaMessage(mfaMessages[result.authState]);
      }
    } catch (error) {
      setErrorMessage(describeLoginError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form<LoginFormValues>
      layout="vertical"
      requiredMark={false}
      onFinish={handleFinish}
    >
      <Form.Item
        label="登录名"
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
        />
      </Form.Item>
      <Form.Item
        label="密码"
        name="password"
        rules={[{ required: true, message: "请输入密码" }]}
      >
        <Input.Password
          aria-label="密码"
          autoComplete="current-password"
          placeholder="请输入密码"
          disabled={submitting}
        />
      </Form.Item>
      {errorMessage ? (
        <Alert showIcon type="error" message={errorMessage} />
      ) : null}
      {mfaMessage ? (
        <Alert showIcon type="warning" message={mfaMessage} />
      ) : null}
      <Button
        type="primary"
        htmlType="submit"
        block
        loading={submitting}
        style={{ marginTop: 16 }}
      >
        登录
      </Button>
    </Form>
  );
};

export default LoginForm;
