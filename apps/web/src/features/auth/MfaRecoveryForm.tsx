import React, { useState } from "react";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useAuth } from "./auth-context";
import { describeMfaError } from "./auth-errors";

const { Paragraph } = Typography;

interface RecoveryValues {
  readonly code: string;
}

export interface MfaRecoveryFormProps {
  readonly onAuthenticated?: (() => void) | undefined;
  readonly onUseTotp?: () => void;
}

export const MfaRecoveryForm: React.FC<MfaRecoveryFormProps> = ({
  onAuthenticated,
  onUseTotp,
}) => {
  const { consumeMfaRecoveryCode } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFinish = async (values: RecoveryValues) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await consumeMfaRecoveryCode(values.code.trim());
      if (result.kind === "authenticated") {
        onAuthenticated?.();
      } else {
        setErrorMessage("安全状态已变化，请刷新页面后重新登录。");
      }
    } catch (error) {
      setErrorMessage(describeMfaError(error, "recovery"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="info"
        title="需要完成恢复码验证"
        description="请输入注册时保存的一次性恢复码。每个恢复码只能使用一次。"
      />
      {errorMessage ? (
        <Alert showIcon type="error" message={errorMessage} />
      ) : null}
      <Form layout="vertical" requiredMark={false} onFinish={handleFinish}>
        <Form.Item
          label="恢复码"
          name="code"
          rules={[{ required: true, message: "请输入恢复码" }]}
        >
          <Input
            aria-label="恢复码"
            placeholder="请输入一次性恢复码"
            disabled={submitting}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={submitting}>
          验证恢复码并进入系统
        </Button>
      </Form>
      {onUseTotp ? (
        <>
          <Paragraph
            type="secondary"
            style={{ margin: 0, textAlign: "center" }}
          >
            想换回验证器登录？
          </Paragraph>
          <Button type="link" block onClick={onUseTotp}>
            退出并使用验证器登录
          </Button>
        </>
      ) : null}
    </Space>
  );
};

export default MfaRecoveryForm;
