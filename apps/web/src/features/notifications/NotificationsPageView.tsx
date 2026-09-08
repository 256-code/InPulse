import React from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type { InpulseApiClient, NotificationItem } from "@generated/api";
import {
  describeNotificationError,
  type NotificationFilter,
  useNotificationActions,
  useNotificationsInfiniteQuery,
  useNotificationUnreadCount,
} from "./notification-query";

const { Title, Paragraph, Text } = Typography;

const notificationTypeLabels: Readonly<Record<string, string>> = {
  PROJECT_CREATED: "项目创建",
  PROJECT_JOINED: "加入项目",
  TASK_ASSIGNED: "任务指派",
  TASK_COMPLETED: "任务完成",
  CHANGE_RECORD_VOIDED: "记录作废",
  CHANGE_RECORD_RESTORED: "记录恢复",
};

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function notificationTypeLabel(type: string): string {
  return notificationTypeLabels[type] ?? type;
}

function parseNotificationId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export interface NotificationsPageViewProps {
  readonly client?: InpulseApiClient;
  readonly filter?: NotificationFilter;
  readonly onFilterChange?: (filter: NotificationFilter) => void;
  readonly onOpenTarget?: (targetPath: string) => void;
}

export const NotificationsPageView: React.FC<NotificationsPageViewProps> = ({
  client,
  filter = "all",
  onFilterChange,
  onOpenTarget,
}) => {
  const unreadQuery = useNotificationUnreadCount({ client });
  const listQuery = useNotificationsInfiniteQuery({ client, filter });
  const actions = useNotificationActions({ client });
  const items = listQuery.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const unreadCount = unreadQuery.data ?? 0;

  const handleOpen = (item: NotificationItem) => {
    const notificationId = parseNotificationId(item.id);
    if (item.readAt === null && notificationId !== null) {
      void actions.mutate({ kind: "read", notificationId });
    }
    if (item.targetPath !== null) {
      onOpenTarget?.(item.targetPath);
    }
  };

  const handleToggle = (item: NotificationItem) => {
    const notificationId = parseNotificationId(item.id);
    if (notificationId === null) {
      return;
    }
    if (item.readAt === null) {
      void actions.mutate({ kind: "read", notificationId });
      return;
    }
    void actions.mutate({ kind: "unread", notificationId });
  };

  let content: React.ReactNode;
  if (listQuery.isPending) {
    content = (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin size="large" description="正在加载通知..." />
      </div>
    );
  } else if (listQuery.isError) {
    content = (
      <Alert
        showIcon
        type="error"
        message={describeNotificationError(listQuery.error)}
      />
    );
  } else if (items.length === 0) {
    content = (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={filter === "unread" ? "没有未读通知" : "还没有通知"}
      />
    );
  } else {
    content = (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <List
          dataSource={items}
          rowKey={(item) => item.id}
          renderItem={(item) => (
            <List.Item data-testid={`notification-item-${item.id}`}>
              <div
                role="button"
                tabIndex={0}
                aria-label={`打开通知：${item.title}`}
                onClick={() => handleOpen(item)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleOpen(item);
                  }
                }}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                  width: "100%",
                  cursor: "pointer",
                }}
              >
                <Badge dot={item.readAt === null} color="#ef7777" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Space align="center" wrap size={8}>
                    <Text strong={item.readAt === null}>{item.title}</Text>
                    <Tag color="blue">
                      {notificationTypeLabel(item.notificationType)}
                    </Tag>
                    <Text type="secondary">
                      {formatNotificationTime(item.createdAt)}
                    </Text>
                  </Space>
                  {item.body.length > 0 ? (
                    <Paragraph
                      type="secondary"
                      style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}
                    >
                      {item.body}
                    </Paragraph>
                  ) : null}
                </div>
                <Space>
                  <Button
                    type="link"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleToggle(item);
                    }}
                  >
                    {item.readAt === null ? "标记已读" : "标记未读"}
                  </Button>
                </Space>
              </div>
            </List.Item>
          )}
        />
        {listQuery.hasNextPage ? (
          <Button
            type="primary"
            ghost
            loading={listQuery.isFetchingNextPage}
            onClick={() => void listQuery.fetchNextPage()}
          >
            加载更多
          </Button>
        ) : null}
      </Space>
    );
  }

  return (
    <Card style={{ borderRadius: 10 }}>
      <Space direction="vertical" size={20} style={{ width: "100%" }}>
        <Space align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            站内通知
          </Title>
          <Tag color="blue">F-28</Tag>
          <Badge count={unreadCount} overflowCount={99} showZero={false} />
        </Space>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          通知只展示当前登录用户的站内消息；已读与未读操作会携带 CSRF 与幂等
          Key，不会影响其他用户。
        </Paragraph>
        <Space wrap>
          <Button
            type={filter === "all" ? "primary" : "default"}
            onClick={() => onFilterChange?.("all")}
          >
            全部
          </Button>
          <Button
            type={filter === "unread" ? "primary" : "default"}
            onClick={() => onFilterChange?.("unread")}
          >
            未读
          </Button>
          <Button
            disabled={unreadCount === 0 || actions.isPending}
            loading={actions.isPending}
            onClick={() => void actions.mutate({ kind: "readAll" })}
          >
            全部已读
          </Button>
        </Space>
        {content}
      </Space>
    </Card>
  );
};
