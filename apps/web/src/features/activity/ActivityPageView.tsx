import React from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import type { InpulseApiClient } from "@generated/api";
import {
  describeActivityError,
  useActivityInfiniteQuery,
} from "./activity-query";

const { Title, Paragraph, Text } = Typography;

const entityTypeLabels: Readonly<Record<string, string>> = {
  PROJECT: "项目",
  MODULE: "模块",
  FEATURE: "功能",
  TASK: "任务",
  CHANGE_RECORD: "变更记录",
  EXTERNAL_LINK: "外部链接",
  TASK_GROUP: "任务组",
  LEFTOVER_ITEM: "遗留项",
};

const activityTypeLabels: Readonly<Record<string, string>> = {
  PROJECT_CREATED: "创建项目",
  PROJECT_JOINED: "加入项目",
  TASK_COMPLETED: "完成任务",
  TASK_ASSIGNED: "指派任务",
  CHANGE_RECORD_VOIDED: "作废记录",
  CHANGE_RECORD_RESTORED: "恢复记录",
};

function formatActivityTime(value: string): string {
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

function entityTypeLabel(type: string): string {
  return entityTypeLabels[type] ?? type;
}

function activityTypeLabel(type: string): string {
  return activityTypeLabels[type] ?? type;
}

export interface ActivityPageViewProps {
  readonly projectId: number;
  readonly client?: InpulseApiClient;
  readonly includeAdminOnly?: boolean;
  readonly onIncludeAdminOnlyChange?: (includeAdminOnly: boolean) => void;
  readonly showAdminToggle?: boolean;
}

export const ActivityPageView: React.FC<ActivityPageViewProps> = ({
  projectId,
  client,
  includeAdminOnly = false,
  onIncludeAdminOnlyChange,
  showAdminToggle = false,
}) => {
  const query = useActivityInfiniteQuery({
    projectId,
    client,
    includeAdminOnly,
  });
  const items = query.data?.pages.flatMap((page) => [...page.items]) ?? [];

  let content: React.ReactNode;
  if (query.isPending) {
    content = (
      <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
        <Spin size="large" description="正在加载项目动态..." />
      </div>
    );
  } else if (query.isError) {
    content = (
      <Alert
        showIcon
        type="error"
        message={describeActivityError(query.error)}
      />
    );
  } else if (items.length === 0) {
    content = (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无项目动态" />
    );
  } else {
    content = (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <List
          dataSource={items}
          rowKey={(item) => item.id}
          renderItem={(item) => (
            <List.Item data-testid={`activity-item-${item.id}`}>
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                <Space align="center" wrap size={8}>
                  <Tag color="blue">{activityTypeLabel(item.activityType)}</Tag>
                  <Tag color="cyan">
                    {entityTypeLabel(item.sourceEntityType)}
                  </Tag>
                  <Text strong>{item.summary}</Text>
                </Space>
                <Text type="secondary">
                  {formatActivityTime(item.occurredAt)} ·{" "}
                  {item.actorId === null ? "系统" : `用户 ${item.actorId}`}
                </Text>
              </Space>
            </List.Item>
          )}
        />
        {query.hasNextPage ? (
          <Button
            type="primary"
            ghost
            loading={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
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
            项目动态
          </Title>
          <Tag color="blue">F-27</Tag>
          <Text type="secondary">项目 #{projectId}</Text>
        </Space>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          此处展示脱敏后的项目活动投影，不包含原始审计快照；普通成员只能看到
          成员可见事件，管理员可以按需查看管理员操作。
        </Paragraph>
        {showAdminToggle ? (
          <Space align="center">
            <Switch
              checked={includeAdminOnly}
              onChange={(value) => onIncludeAdminOnlyChange?.(value)}
              aria-label="包含管理员操作"
            />
            <Text>包含管理员操作</Text>
          </Space>
        ) : null}
        {content}
      </Space>
    </Card>
  );
};
