import React from "react";
import { Badge, Button } from "antd";
import type { InpulseApiClient } from "@generated/api";
import { useNotificationUnreadCount } from "./notification-query";

export interface NotificationBellProps {
  readonly client?: InpulseApiClient | undefined;
  readonly enabled?: boolean;
  readonly onOpen: () => void;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  client,
  enabled = true,
  onOpen,
}) => {
  const unreadQuery = useNotificationUnreadCount({ client, enabled });
  const unreadCount = unreadQuery.data ?? 0;

  return (
    <Badge count={unreadCount} offset={[-4, 4]} overflowCount={99}>
      <Button
        type="text"
        className="notification-button"
        aria-label="通知"
        onClick={onOpen}
        style={{ minWidth: 30, minHeight: 30, color: "#718399" }}
      >
        通知
      </Button>
    </Badge>
  );
};
