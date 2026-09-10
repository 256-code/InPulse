import React, { useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type {
  CreateProjectResponse,
  InpulseApiClient,
  ProjectItem,
} from "@generated/api";
import { CreateProjectModal } from "./CreateProjectModal";
import {
  ArchiveProjectModal,
  EditProjectModal,
  RestoreProjectModal,
} from "./ProjectManagementModals";

const { Text } = Typography;

export interface ProjectsPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly creatorName: string;
  readonly creatorUserId?: number | undefined;
  readonly isAdmin?: boolean | undefined;
  readonly createdProject?: CreateProjectResponse | null;
  readonly onCreated?: (response: CreateProjectResponse) => void;
  readonly onOpenActivity?: ((projectId: number) => void) | undefined;
  readonly onOpenModules?: ((projectId: number) => void) | undefined;
  readonly onOpenMembers?: ((projectId: number) => void) | undefined;
  readonly onSearch?: ((query: string) => void) | undefined;
  readonly projects?: readonly ProjectItem[] | undefined;
  readonly projectsLoading?: boolean | undefined;
  readonly projectsError?: string | undefined;
  readonly onRetryProjects?: (() => void) | undefined;
}

export const ProjectsPageView: React.FC<ProjectsPageViewProps> = ({
  client,
  creatorName,
  creatorUserId,
  isAdmin = false,
  createdProject,
  onCreated,
  onOpenActivity,
  onOpenModules,
  onOpenMembers,
  onSearch,
  projects = [],
  projectsLoading = false,
  projectsError,
  onRetryProjects,
}) => {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectItem | null>(null);
  const [archiving, setArchiving] = useState<ProjectItem | null>(null);
  const [restoring, setRestoring] = useState<ProjectItem | null>(null);
  const [managementSuccess, setManagementSuccess] = useState<string | null>(
    null,
  );

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">项目与功能 · F-05</span>
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
                    {isAdmin && onOpenMembers && (
                      <Button
                        size="small"
                        onClick={() => onOpenMembers(createdProject.project.id)}
                      >
                        管理成员
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
          {managementSuccess ? (
            <Alert showIcon type="success" title={managementSuccess} />
          ) : null}
          {projectsLoading ? (
            <Spin description="正在加载项目列表" />
          ) : projectsError ? (
            <Alert
              type="error"
              showIcon
              title={projectsError}
              action={
                onRetryProjects ? (
                  <Button onClick={onRetryProjects}>重试</Button>
                ) : undefined
              }
            />
          ) : projects.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无可见项目；系统管理员或已加入成员创建的项目会显示在这里。"
            />
          ) : (
            <List
              dataSource={[...projects]}
              rowKey={(item) => item.id}
              renderItem={(project) => (
                <Card
                  className="project-card"
                  title={
                    <Space wrap>
                      <span>{project.name}</span>
                      <Tag
                        color={
                          project.status === "ACTIVE" ? "green" : "default"
                        }
                      >
                        {project.status === "ACTIVE" ? "正常" : "已归档"}
                      </Tag>
                    </Space>
                  }
                  extra={
                    <Space wrap>
                      <Button
                        size="small"
                        data-testid={`edit-project-${project.id}`}
                        onClick={() => setEditing(project)}
                      >
                        编辑
                      </Button>
                      {isAdmin ? (
                        project.status === "ACTIVE" ? (
                          <Button
                            size="small"
                            danger
                            data-testid={`archive-project-${project.id}`}
                            onClick={() => setArchiving(project)}
                          >
                            归档
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            data-testid={`restore-project-${project.id}`}
                            onClick={() => setRestoring(project)}
                          >
                            恢复
                          </Button>
                        )
                      ) : null}
                      <Button onClick={() => onOpenModules?.(project.id)}>
                        管理模块
                      </Button>
                      {isAdmin && onOpenMembers ? (
                        <Button
                          size="small"
                          onClick={() => onOpenMembers(project.id)}
                        >
                          管理成员
                        </Button>
                      ) : null}
                      <Button
                        type="primary"
                        size="small"
                        onClick={() => onOpenActivity?.(project.id)}
                      >
                        查看项目动态
                      </Button>
                    </Space>
                  }
                >
                  <Text type="secondary">
                    {project.code} · {project.memberCount} 位活跃成员
                  </Text>
                  {project.description ? (
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {project.description}
                    </p>
                  ) : null}
                  <Button size="small" onClick={() => onSearch?.(project.code)}>
                    搜索项目
                  </Button>
                </Card>
              )}
            />
          )}
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
      {editing ? (
        <EditProjectModal
          open
          project={editing}
          client={client}
          onClose={() => setEditing(null)}
          onUpdated={(updated) => {
            setEditing(null);
            setManagementSuccess(
              `项目「${updated.name}」已更新，当前版本 ${updated.rowVersion}。`,
            );
          }}
        />
      ) : null}
      {archiving ? (
        <ArchiveProjectModal
          open
          project={archiving}
          client={client}
          onClose={() => setArchiving(null)}
          onArchived={(updated) => {
            setArchiving(null);
            setManagementSuccess(
              `项目「${updated.name}」已归档，历史仍可查看。`,
            );
          }}
        />
      ) : null}
      {restoring ? (
        <RestoreProjectModal
          open
          project={restoring}
          client={client}
          onClose={() => setRestoring(null)}
          onRestored={(updated) => {
            setRestoring(null);
            setManagementSuccess(`项目「${updated.name}」已恢复为正常状态。`);
          }}
        />
      ) : null}
    </>
  );
};
