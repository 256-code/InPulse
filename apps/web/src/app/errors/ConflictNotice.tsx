import React from "react";
import { Alert, Button, Space } from "antd";

export interface ConflictNoticeProps {
  readonly message?: string;
  readonly description?: string;
  readonly onReload?: () => void;
  readonly onClose?: () => void;
}

export const ConflictNotice: React.FC<ConflictNoticeProps> = ({
  message = "数据冲突（409 Conflict）",
  description = "当前数据已被其他用户或操作修改。为防止数据覆盖，你的本地输入已保留，请重新加载最新数据后再行提交。",
  onReload,
  onClose
}) => {
  const alertProps: React.ComponentProps<typeof Alert> = {
    type: "warning",
    showIcon: true,
    message,
    description: (
      <div>
        <p style={{ margin: "0 0 8px 0" }}>{description}</p>
        {onReload && (
          <Space>
            <Button size="small" type="primary" onClick={onReload}>
              重新加载最新数据
            </Button>
          </Space>
        )}
      </div>
    )
  };

  if (onClose) {
    alertProps.closable = true;
    alertProps.onClose = onClose;
  }

  return (
    <div data-testid="conflict-notice" style={{ margin: "16px 0" }}>
      <Alert {...alertProps} />
    </div>
  );
};
