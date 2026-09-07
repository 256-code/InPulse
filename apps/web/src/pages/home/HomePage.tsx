import React from "react";
import { Card, Typography, Space, Tag } from "antd";

const { Title, Paragraph, Text } = Typography;

export const HomePage: React.FC = () => {
  return (
    <Card style={{ marginTop: 24, borderRadius: 8 }}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <div>
          <Space align="center">
            <Title level={3} style={{ margin: 0 }}>
              InPulse 前端基础框架
            </Title>
            <Tag color="green">F-30 就绪</Tag>
          </Space>
          <Paragraph type="secondary" style={{ marginTop: 8 }}>
            模块化前端基础架构已就绪：支持 TanStack Query、Ant Design
            6.x、严格分层依赖治理及自动化路由扩展。
          </Paragraph>
        </div>
        <Card type="inner" title="核心基础设施说明">
          <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
            <li>
              <Text strong>路由与安全</Text>：基于 <code>shared/routing</code>{" "}
              与 <code>AppRouter</code>{" "}
              自动聚合，支持声明式鉴权壳与系统管理员校验。
            </li>
            <li>
              <Text strong>分层依赖检查</Text>：启用{" "}
              <code>dependency-cruiser</code> 规则，保证{" "}
              <code>app -&gt; pages -&gt; features -&gt; shared/generated</code>{" "}
              依赖单向流动。
            </li>
            <li>
              <Text strong>409 冲突防护</Text>：提供 <code>ConflictNotice</code>{" "}
              交互规范，保证本地未提交数据不被覆盖并提供重新加载机制。
            </li>
          </ul>
        </Card>
      </Space>
    </Card>
  );
};

export default HomePage;
