import React from "react";
import { Layout, Menu, Typography } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";

const { Header, Content, Footer } = Layout;
const { Text } = Typography;

export const AppLayout: React.FC = () => {
  const location = useLocation();

  const menuItems = [
    {
      key: "/",
      label: <Link to="/">首页</Link>,
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Header
        style={{
          display: "flex",
          alignItems: "center",
          background: "#001529",
          padding: "0 24px",
        }}
      >
        <div
          style={{
            color: "#fff",
            fontWeight: 600,
            fontSize: 18,
            marginRight: 32,
          }}
        >
          InPulse
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItems}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content
        style={{
          padding: "24px",
          maxWidth: 1200,
          margin: "0 auto",
          width: "100%",
        }}
      >
        <Outlet />
      </Content>
      <Footer style={{ textAlign: "center", color: "#8c8c8c" }}>
        <Text type="secondary">InPulse 软件研发功能迭代与任务协作系统</Text>
      </Footer>
    </Layout>
  );
};
