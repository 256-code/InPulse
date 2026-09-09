import React, { useState } from "react";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useAuth } from "./auth-context";
import { describeMfaError } from "./auth-errors";

const { Paragraph } = Typography;

interface VerifyValues {
  readonly code: string;
}

export interface MfaChallengeFormProps {
  readonly onAuthenticated?: (() => void) | undefined;
  readonly onUseRecovery?: () => void;
}

export const MfaChallengeForm: React.FC<MfaChallengeFormProps> = ({
  onAuthenticated,
  onUseRecovery,
}) => {
  const { verifyMfa } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFinish = async (values: VerifyValues) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await verifyMfa(values.code.trim());
      if (result.kind === "authenticated") {
        onAuthenticated?.();
      } else {
        setErrorMessage("安全状态已变化，请刷新页面后重新登录。");
      }
    } catch (error) {
      setErrorMessage(describeMfaError(error, "challenge"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="info"
        title="需要完成 TOTP 验证"
        description="请输入验证器应用中的当前 6 位动态验证码。"
      />
      {errorMessage ? (
        <Alert showIcon type="error" message={errorMessage} />
      ) : null}
      <Form layout="vertical" requiredMark={false} onFinish={handleFinish}>
        <Form.Item
          label="6 位验证码"
          name="code"
          rules={[
            { required: true, message: "请输入验证码" },
            { pattern: /^\d{6}$/, message: "验证码必须为 6 位数字" },
          ]}
        >
          <Input
            aria-label="6 位验证码"
            maxLength={6}
            inputMode="numeric"
            placeholder="请输入验证器中的 6 位数字"
            disabled={submitting}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          验证并进入系统
        </Button>
      </Form>
      {onUseRecovery ? (
        <>
          <Paragraph
            type="secondary"
            style={{ margin: 0, textAlign: "center" }}
          >
            无法访问验证器？
          </Paragraph>
          <Button type="link" block onClick={onUseRecovery}>
            退出并使用恢复码登录
          </Button>
        </>
      ) : null}
    </Space>
  );
};

export default MfaChallengeForm;
