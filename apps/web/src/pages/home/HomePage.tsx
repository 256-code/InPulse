import React from "react";
import { Card, Col, Empty, Row, Space, Tag, Typography } from "antd";

const { Title, Paragraph } = Typography;

const workspaceEntries = [
  {
    key: "projects",
    title: "项目与功能",
    description: "项目、模块、功能与任务入口，等待正式契约和页面接入。",
  },
  {
    key: "tasks",
    title: "我的任务",
    description: "跨项目任务列表与状态筛选，等待任务查询接口接入。",
  },
  {
    key: "records",
    title: "迭代记录",
    description: "迭代变化、版本与验证结果入口，等待记录接口接入。",
  },
] as const;

export const HomePage: React.FC = () => {
  return (
    <Space direction="vertical" size={24} style={{ width: "100%" }}>
      <Card style={{ borderRadius: 10 }}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space align="center" wrap>
            <Title level={3} style={{ margin: 0 }}>
              工作台
            </Title>
            <Tag color="blue">F-30 视觉壳</Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
            按设计参考 v1.0 建立顶部工作区、左侧导航和中心卡片；当前只展示
            信息架构，不包含 Mock 业务数据。
          </Paragraph>
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        {workspaceEntries.map((entry) => (
          <Col key={entry.key} xs={24} lg={8}>
            <Card
              title={entry.title}
              style={{ minHeight: 190, borderRadius: 10 }}
            >
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={entry.description}
              />
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
};

export default HomePage;
