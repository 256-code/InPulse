import React, { useState } from "react";
import { Alert, Button, Card, Empty, Space, Tag, Typography } from "antd";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";

const { Title, Paragraph, Text } = Typography;

export interface ProjectsPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly creatorName: string;
  readonly createdProject?: CreateProjectResponse | null;
  readonly onCreated?: (response: CreateProjectResponse) => void;
  readonly onOpenActivity?: (projectId: number) => void;
  readonly onSearch?: (query: string) => void;
}

export const ProjectsPageView: React.FC<ProjectsPageViewProps> = ({
  client,
  creatorName,
  createdProject,
  onCreated,
  onOpenActivity,
  onSearch,
}) => {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Card style={{ borderRadius: 10 }}>
      <Space orientation="vertical" size={20} style={{ width: "100%" }}>
        <Space
          align="center"
          wrap
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <Space align="center" wrap>
            <Title level={3} style={{ margin: 0 }}>
              项目与功能
            </Title>
            <Tag color="blue">F-04</Tag>
          </Space>
          <Button
            type="primary"
            data-testid="create-project-button"
            onClick={() => setCreateOpen(true)}
          >
            新建项目
          </Button>
        </Space>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          项目是顶层业务容器。创建者自动成为活跃成员，创建流程不可取消该成员关系。
        </Paragraph>
        {createdProject ? (
          <Alert
            showIcon
            type="success"
            title="项目创建成功"
            description={
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                <Text strong>
                  {createdProject.project.name}（{createdProject.project.code}）
                </Text>
                <Text type="secondary">
                  已自动生成未分类模块，活动、通知与搜索投影已在同一事务中写入。
                </Text>
                <Space wrap>
                  <Button
                    type="primary"
                    size="small"
                    data-testid="open-created-project-activity"
                    onClick={() => onOpenActivity?.(createdProject.project.id)}
                  >
                    查看项目动态
                  </Button>
                  <Button
                    size="small"
                    data-testid="search-created-project"
                    onClick={() => onSearch?.(createdProject.project.code)}
                  >
                    搜索项目
                  </Button>
                </Space>
              </Space>
            }
          />
        ) : null}
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="项目列表接口尚未接入；当前可先创建项目，并通过搜索、通知和项目动态验证纵切片。"
        />
      </Space>
      <CreateProjectModal
        open={createOpen}
        creatorName={creatorName}
        client={client}
        onClose={() => setCreateOpen(false)}
        onCreated={(response) => {
          onCreated?.(response);
        }}
      />
    </Card>
  );
};
