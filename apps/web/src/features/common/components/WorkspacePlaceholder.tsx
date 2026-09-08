import React from "react";
import { Card, Empty, Space, Tag, Typography } from "antd";

const { Title, Paragraph } = Typography;

export interface WorkspacePlaceholderProps {
  readonly title: string;
  readonly description: string;
  readonly status?: string;
}

export const WorkspacePlaceholder: React.FC<WorkspacePlaceholderProps> = ({
  title,
  description,
  status = "待接入",
}) => {
  return (
    <Card style={{ borderRadius: 10 }}>
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Space align="center" wrap>
          <Title level={3} style={{ margin: 0 }}>
            {title}
          </Title>
          <Tag color="blue">{status}</Tag>
        </Space>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          {description}
        </Paragraph>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="页面已建立，业务数据将在接口和契约就绪后接入。"
        />
      </Space>
    </Card>
  );
};
