import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { useAuth, type MfaEnrollmentMaterial } from "./auth-context";
import { describeMfaError } from "./auth-errors";

const { Text } = Typography;

interface ConfirmValues {
  readonly code: string;
}

export interface MfaEnrollmentFormProps {
  readonly onAuthenticated?: (() => void) | undefined;
}

export const MfaEnrollmentForm: React.FC<MfaEnrollmentFormProps> = ({
  onAuthenticated,
}) => {
  const {
    mfaState,
    beginMfaEnrollment,
    confirmMfaEnrollment,
    finishMfaEnrollment,
    pendingRecoveryCodes,
  } = useAuth();
  const requestStartedRef = useRef(false);
  const [material, setMaterial] = useState<MfaEnrollmentMaterial | null>(null);
  const [loadingMaterial, setLoadingMaterial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadMaterial = useCallback(async () => {
    if (mfaState !== "MFA_ENROLLMENT") {
      return;
    }
    setLoadingMaterial(true);
    setErrorMessage(null);
    try {
      setMaterial(await beginMfaEnrollment());
    } catch (error) {
      setErrorMessage(describeMfaError(error, "enrollment"));
    } finally {
      setLoadingMaterial(false);
    }
  }, [beginMfaEnrollment, mfaState]);

  useEffect(() => {
    if (requestStartedRef.current) {
      return;
    }
    requestStartedRef.current = true;
    void loadMaterial();
  }, [loadMaterial]);

  const handleConfirm = async (values: ConfirmValues) => {
    if (material === null) {
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await confirmMfaEnrollment(
        values.code,
        material.enrollmentGeneration,
      );
      if (result.kind === "cancelled") {
        setErrorMessage("安全状态已变化，请刷新页面后重新登录。");
      }
    } catch (error) {
      setErrorMessage(describeMfaError(error, "enrollment"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleFinish = () => {
    finishMfaEnrollment();
    onAuthenticated?.();
  };

  const copyValue = async (value: string) => {
    try {
      await navigator.clipboard?.writeText(value);
    } catch {
      setErrorMessage("复制失败，请手动记录。");
    }
  };

  if (pendingRecoveryCodes !== null) {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Alert
          showIcon
          type="success"
          title="TOTP 已启用，请立即保存恢复码"
          description="恢复码只显示一次，请离线保存并妥善保管。"
        />
        <Text strong>一次性恢复码</Text>
        <pre
          data-testid="recovery-codes"
          style={{
            margin: 0,
            padding: 12,
            background: "#eef2f7",
            borderRadius: 6,
          }}
        >
          {pendingRecoveryCodes.join("\n")}
        </pre>
        <Button onClick={() => void copyValue(pendingRecoveryCodes.join("\n"))}>
          复制恢复码
        </Button>
        <Button type="primary" block onClick={handleFinish}>
          完成并进入系统
        </Button>
      </Space>
    );
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        showIcon
        type="warning"
        title="首次登录需要注册 TOTP"
        description="在验证器应用中添加下方账户密钥。该密钥只显示一次，请勿截图或放入日志。"
      />
      {errorMessage ? (
        <Alert showIcon type="error" title={errorMessage} />
      ) : null}
      <Form layout="vertical" requiredMark={false} onFinish={handleConfirm}>
        <Form.Item label="验证器账户密钥">
          <Input
            aria-label="验证器账户密钥"
            readOnly
            value={material?.secret ?? ""}
            placeholder="加载中..."
          />
        </Form.Item>
        <Button
          type="link"
          disabled={loadingMaterial || material === null}
          onClick={() => void copyValue(material?.secret ?? "")}
          style={{ paddingLeft: 0, marginBottom: 12 }}
        >
          复制密钥
        </Button>
        <Form.Item label="验证器地址">
          <Input
            aria-label="验证器地址"
            readOnly
            value={material?.otpauthUri ?? ""}
            placeholder="加载中..."
          />
        </Form.Item>
        <Button
          type="link"
          disabled={loadingMaterial || material === null}
          onClick={() => void copyValue(material?.otpauthUri ?? "")}
          style={{ paddingLeft: 0, marginBottom: 12 }}
        >
          复制验证器地址
        </Button>
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
            disabled={loadingMaterial || material === null || submitting}
          />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={submitting}
          disabled={loadingMaterial || material === null}
        >
          确认并启用
        </Button>
        <Button
          type="link"
          block
          loading={loadingMaterial}
          onClick={() => void loadMaterial()}
          style={{ marginTop: 8 }}
        >
          重新获取验证器信息
        </Button>
      </Form>
    </Space>
  );
};

export default MfaEnrollmentForm;
