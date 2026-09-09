import React, { useState } from "react";
import { Alert, Button, Card, Empty, Space, Typography } from "antd";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";

const { Text } = Typography;

export interface ProjectsPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly creatorName: string;
  readonly creatorUserId?: number | undefined;
  readonly createdProject?: CreateProjectResponse | null;
  readonly onCreated?: (response: CreateProjectResponse) => void;
  readonly onOpenActivity?: (projectId: number) => void;
  readonly onOpenModules?: (projectId: number) => void;
  readonly onSearch?: (query: string) => void;
}

export const ProjectsPageView: React.FC<ProjectsPageViewProps> = ({
  client,
  creatorName,
  creatorUserId,
  createdProject,
  onCreated,
  onOpenActivity,
  onOpenModules,
  onSearch,
}) => {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">项目与功能 · F-04</span>
          <h1>项目与功能</h1>
          <p>
            项目是顶层业务容器。创建者自动成为活跃成员，创建流程不可取消该成员关系。
          </p>
        </div>
        <div className="catalog-actions">
          <Button
            type="primary"
            data-testid="create-project-button"
            onClick={() => setCreateOpen(true)}
          >
            新建项目
          </Button>
        </div>
      </div>
      <Card className="catalog-panel">
        <Space orientation="vertical" size={20} style={{ width: "100%" }}>
          {createdProject ? (
            <Alert
              showIcon
              type="success"
              title="项目创建成功"
              description={
                <Space
                  orientation="vertical"
                  size={4}
                  style={{ width: "100%" }}
                >
                  <Text strong>
                    {createdProject.project.name}（{createdProject.project.code}
                    ）
                  </Text>
                  <Text type="secondary">
                    已自动生成未分类模块，活动、通知与搜索投影已在同一事务中写入。
                  </Text>
                  <Space wrap>
                    {onOpenModules && (
                      <Button
                        onClick={() => onOpenModules(createdProject.project.id)}
                      >
                        管理模块
                      </Button>
                    )}
                    <Button
                      type="primary"
                      size="small"
                      data-testid="open-created-project-activity"
                      onClick={() =>
                        onOpenActivity?.(createdProject.project.id)
                      }
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
      </Card>
      <CreateProjectModal
        open={createOpen}
        creatorName={creatorName}
        creatorUserId={creatorUserId}
        client={client}
        onClose={() => setCreateOpen(false)}
        onCreated={(response) => {
          onCreated?.(response);
        }}
      />
    </>
  );
};
