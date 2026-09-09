import React, { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Modal, Result } from "antd";
import { useAuth } from "./auth-context";
import { describeMfaError } from "./auth-errors";

interface ReauthenticateValues {
  readonly password: string;
  readonly code: string;
}

export interface AdminReauthenticateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSuccess?: () => void;
}

export const AdminReauthenticateModal: React.FC<
  AdminReauthenticateModalProps
> = ({ open, onClose, onSuccess }) => {
  const [form] = Form.useForm<ReauthenticateValues>();
  const { reauthenticateAdmin } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      setErrorMessage(null);
      setSucceeded(false);
    }
  }, [form, open]);

  const handleFinish = async (values: ReauthenticateValues) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await reauthenticateAdmin({
        password: values.password,
        code: values.code.trim(),
      });
      setSucceeded(true);
      onSuccess?.();
    } catch (error) {
      setErrorMessage(describeMfaError(error, "reauth"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      title="管理员安全验证"
      onCancel={handleClose}
      footer={null}
      destroyOnHidden
      mask={{ closable: !submitting }}
      className="catalog-modal"
    >
      {succeeded ? (
        <Result
          status="success"
          title="重认证成功"
          subTitle="管理员密码与当前 TOTP 校验通过，5 分钟内可执行高风险操作。"
          extra={
            <Button type="primary" onClick={handleClose}>
              完成
            </Button>
          }
        />
      ) : (
        <>
          <Alert
            showIcon
            type="info"
            title="高风险操作前需要重新验证身份"
            description="请输入管理员密码与验证器中的当前 6 位验证码。"
            style={{ marginBottom: 16 }}
          />
          {errorMessage ? (
            <Alert
              showIcon
              type="error"
              message={errorMessage}
              style={{ marginBottom: 16 }}
            />
          ) : null}
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            onFinish={handleFinish}
          >
            <Form.Item
              label="管理员密码"
              name="password"
              rules={[{ required: true, message: "请输入管理员密码" }]}
            >
              <Input.Password
                aria-label="管理员密码"
                autoComplete="current-password"
                placeholder="请输入密码"
                disabled={submitting}
              />
            </Form.Item>
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
              验证身份
            </Button>
          </Form>
        </>
      )}
    </Modal>
  );
};

export default AdminReauthenticateModal;
