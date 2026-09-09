import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Empty,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import type {
  InpulseApiClient,
  ProjectMemberReassignmentItem,
  ProjectMemberRecordItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  describeUserDirectoryError,
  useUserDirectoryQuery,
} from "@features/users/user-directory-query";
import {
  isAdminReauthRequired,
  projectMemberErrorMessage,
  useProjectMemberUnfinishedTasks,
  useProjectMembers,
} from "./project-member-query";

const { Text } = Typography;

interface ReassignmentChoice {
  readonly enabled: boolean;
  readonly assigneeId?: number | undefined;
}

export interface ProjectMembersPageViewProps {
  readonly projectId: number;
  readonly client?: InpulseApiClient | undefined;
}

export const ProjectMembersPageView: React.FC<ProjectMembersPageViewProps> = ({
  projectId,
  client,
}) => {
  const { query, addMutation, removeMutation } = useProjectMembers(
    projectId,
    client,
  );
  const directory = useUserDirectoryQuery({ client });
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [removing, setRemoving] = useState<ProjectMemberRecordItem | null>(
    null,
  );
  const [reassignChoices, setReassignChoices] = useState<
    Readonly<Record<number, ReassignmentChoice>>
  >({});
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthReady, setReauthReady] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const unfinished = useProjectMemberUnfinishedTasks(
    projectId,
    removing?.userId,
    client,
    removing !== null,
  );

  const activeMembers = useMemo(
    () => (query.data?.items ?? []).filter((item) => item.status === "ACTIVE"),
    [query.data],
  );
  const activeUserIds = useMemo(
    () => new Set(activeMembers.map((item) => item.userId)),
    [activeMembers],
  );
  const addCandidates = useMemo(
    () => (directory.data ?? []).filter((user) => !activeUserIds.has(user.id)),
    [activeUserIds, directory.data],
  );
  const assigneeOptions = useMemo(
    () =>
      activeMembers
        .filter((member) => member.userId !== removing?.userId)
        .map((member) => ({
          value: member.userId,
          label: member.name,
        })),
    [activeMembers, removing?.userId],
  );
  const mutationError = addMutation.isError
    ? addMutation.error
    : removeMutation.isError
      ? removeMutation.error
      : undefined;

  useEffect(() => {
    if (query.isError && isAdminReauthRequired(query.error)) {
      setReauthOpen(true);
    }
  }, [query.error, query.isError]);

  useEffect(() => {
    if (unfinished.isError && isAdminReauthRequired(unfinished.error)) {
      setReauthOpen(true);
    }
  }, [unfinished.error, unfinished.isError]);

  useEffect(() => {
    if (mutationError !== undefined && isAdminReauthRequired(mutationError)) {
      setReauthOpen(true);
    }
  }, [mutationError]);

  const openAdd = () => {
    setAddOpen(true);
    setSelectedUserId(null);
    setActionError(null);
    setSuccess(null);
    setReauthReady(false);
    addMutation.reset();
  };

  const closeAdd = () => {
    if (addMutation.isPending) return;
    setAddOpen(false);
    addMutation.reset();
  };

  const openRemove = (member: ProjectMemberRecordItem) => {
    setRemoving(member);
    setReassignChoices({});
    setActionError(null);
    setSuccess(null);
    setReauthReady(false);
    removeMutation.reset();
  };

  const closeRemove = () => {
    if (removeMutation.isPending) return;
    setRemoving(null);
    removeMutation.reset();
  };

  const submitAdd = async () => {
    if (selectedUserId === null || addMutation.isPending) return;
    setActionError(null);
    try {
      await addMutation.mutateAsync({ userId: selectedUserId });
      setAddOpen(false);
      setSuccess("成员已添加，项目成员列表已更新。");
    } catch (error) {
      if (!isAdminReauthRequired(error)) {
        setActionError(projectMemberErrorMessage(error));
      }
    }
  };

  const submitRemove = async () => {
    if (removing === null || removeMutation.isPending) return;
    const tasks = unfinished.data?.items ?? [];
    const reassignments: ProjectMemberReassignmentItem[] = [];
    for (const task of tasks) {
      const choice = reassignChoices[task.taskId];
      if (!choice?.enabled) continue;
      if (choice.assigneeId === undefined) {
        setActionError(`请为任务 ${task.code} 选择改派成员。`);
        return;
      }
      reassignments.push({
        taskId: task.taskId,
        moduleId: task.moduleId,
        featureId: task.featureId,
        rowVersion: task.rowVersion,
        assigneeId: choice.assigneeId,
      });
    }
    setActionError(null);
    try {
      await removeMutation.mutateAsync({
        userId: removing.userId,
        reassignments,
      });
      setRemoving(null);
      setSuccess(
        "成员已移出项目，未改派任务保留原负责人且该成员已失去处理权限。",
      );
    } catch (error) {
      if (!isAdminReauthRequired(error)) {
        setActionError(projectMemberErrorMessage(error));
      }
    }
  };

  const handleReauthSuccess = () => {
    setReauthOpen(false);
    setReauthReady(true);
    addMutation.reset();
    removeMutation.reset();
    void query.refetch();
    if (removing !== null) {
      void unfinished.refetch();
    }
  };

  const disabledTaskReassignment = (taskId: number, enabled: boolean) => {
    setReassignChoices((current) => ({
      ...current,
      [taskId]: enabled
        ? { enabled: true }
        : { enabled: false, assigneeId: undefined },
    }));
  };

  const setReassignmentAssignee = (taskId: number, assigneeId: number) => {
    setReassignChoices((current) => ({
      ...current,
      [taskId]: { enabled: true, assigneeId },
    }));
  };

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">系统管理员 · F-05</span>
          <h1>项目成员管理</h1>
          <p>
            系统管理员可添加或移除项目成员；移除不会删除任何历史数据，
            未改派任务保留原负责人，但原成员将立即失去处理权限。
          </p>
        </div>
        <Button type="primary" onClick={openAdd}>
          添加成员
        </Button>
      </div>

      <Space orientation="vertical" style={{ width: "100%" }} size={16}>
        {success ? <Alert type="success" showIcon title={success} /> : null}
        {query.isPending ? (
          <Spin description="正在加载项目成员" />
        ) : query.isError ? (
          <Alert
            type="error"
            showIcon
            title={projectMemberErrorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        ) : (query.data?.items.length ?? 0) === 0 ? (
          <Empty description="暂无项目成员" />
        ) : (
          <List
            dataSource={[...(query.data?.items ?? [])]}
            rowKey={(item) => item.membershipId}
            renderItem={(member) => (
              <Card
                title={
                  <Space wrap>
                    <Avatar size={24} className="person-avatar">
                      {member.name.slice(0, 1)}
                    </Avatar>
                    <span>{member.name}</span>
                    <Tag
                      color={member.status === "ACTIVE" ? "green" : "default"}
                    >
                      {member.status === "ACTIVE" ? "活跃成员" : "已移除"}
                    </Tag>
                  </Space>
                }
                extra={
                  member.status === "ACTIVE" ? (
                    <Button danger onClick={() => openRemove(member)}>
                      移除
                    </Button>
                  ) : undefined
                }
              >
                <Text type="secondary">
                  加入时间：
                  {new Date(member.joinedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </Text>
                {member.removedAt ? (
                  <p>
                    <Text type="secondary">
                      移除时间：
                      {new Date(member.removedAt).toLocaleString("zh-CN", {
                        hour12: false,
                      })}
                    </Text>
                  </p>
                ) : null}
                {member.status === "REMOVED" ? (
                  <p>已移除成员的历史任务、记录和审计均保留，可重新加入。 </p>
                ) : null}
              </Card>
            )}
          />
        )}
      </Space>

      <Modal
        open={addOpen}
        title="添加项目成员"
        onCancel={closeAdd}
        footer={null}
        mask={{ closable: !addMutation.isPending }}
      >
        <Alert
          showIcon
          type="info"
          title="添加后该用户将成为项目活跃成员"
          description="系统管理员可在成员历史中重新加入已移除用户；停用用户不会出现在目录中。"
          style={{ marginBottom: 16 }}
        />
        {directory.isPending ? (
          <Spin description="正在加载用户目录" />
        ) : directory.isError ? (
          <Alert
            type="error"
            showIcon
            title={describeUserDirectoryError(directory.error)}
          />
        ) : addCandidates.length === 0 ? (
          <Empty description="没有可添加的启用用户" />
        ) : (
          <div className="impact-fieldset">
            <div className="check-list">
              {addCandidates.map((user) => (
                <div className="member-option" key={user.id}>
                  <Checkbox
                    checked={selectedUserId === user.id}
                    aria-label={`选择成员：${user.name}`}
                    onChange={(event) =>
                      setSelectedUserId(event.target.checked ? user.id : null)
                    }
                  />
                  <Avatar size={24} className="person-avatar">
                    {user.name.slice(0, 1)}
                  </Avatar>
                  <span className="member-name">{user.name}</span>
                  <span className="member-role">
                    {user.isAdmin ? "系统管理员" : "启用用户"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {actionError ? (
          <Alert
            type="error"
            showIcon
            title={actionError}
            style={{ marginTop: 16 }}
          />
        ) : null}
        {reauthReady ? (
          <Alert
            type="success"
            showIcon
            title="管理员安全验证已完成，请重新点击添加。"
            style={{ marginTop: 16 }}
          />
        ) : null}
        <Space
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}
        >
          <Button onClick={closeAdd} disabled={addMutation.isPending}>
            取消
          </Button>
          <Button
            type="primary"
            loading={addMutation.isPending}
            disabled={selectedUserId === null}
            onClick={() => void submitAdd()}
          >
            添加成员
          </Button>
        </Space>
      </Modal>

      <Modal
        open={removing !== null}
        title="移除项目成员"
        onCancel={closeRemove}
        footer={null}
        mask={{ closable: !removeMutation.isPending }}
      >
        <Alert
          showIcon
          type="warning"
          title={`确认从项目中移除 ${removing?.name ?? ""}？`}
          description="成员历史、已完成任务和审计记录均保留；未完成任务可选择改派，否则保留原负责人但该成员不能继续处理。"
          style={{ marginBottom: 16 }}
        />
        {unfinished.isPending ? (
          <Spin description="正在检查未完成任务" />
        ) : unfinished.isError ? (
          <Alert
            type="error"
            showIcon
            title={projectMemberErrorMessage(unfinished.error)}
          />
        ) : (unfinished.data?.items.length ?? 0) === 0 ? (
          <Alert type="success" showIcon title="该成员没有未完成任务。" />
        ) : (
          <List
            dataSource={[...(unfinished.data?.items ?? [])]}
            rowKey={(task) => task.taskId}
            renderItem={(task) => {
              const choice = reassignChoices[task.taskId];
              return (
                <Card size="small" style={{ marginBottom: 12 }}>
                  <Space orientation="vertical" style={{ width: "100%" }}>
                    <span>
                      <Text strong>{task.code}</Text> · {task.title}
                    </span>
                    <Checkbox
                      checked={choice?.enabled === true}
                      aria-label={`改派任务 ${task.code}`}
                      onChange={(event) =>
                        disabledTaskReassignment(
                          task.taskId,
                          event.target.checked,
                        )
                      }
                    >
                      改派给其他活跃成员
                    </Checkbox>
                    {choice?.enabled ? (
                      <Select
                        aria-label={`选择 ${task.code} 的改派成员`}
                        value={choice.assigneeId ?? undefined}
                        placeholder="选择改派成员"
                        style={{ width: "100%" }}
                        options={assigneeOptions}
                        disabled={assigneeOptions.length === 0}
                        onChange={(value) => {
                          if (value !== undefined) {
                            setReassignmentAssignee(task.taskId, value);
                          }
                        }}
                      />
                    ) : (
                      <Text type="secondary">保留原负责人</Text>
                    )}
                  </Space>
                </Card>
              );
            }}
          />
        )}
        {actionError ? (
          <Alert
            type="error"
            showIcon
            title={actionError}
            style={{ marginTop: 16 }}
          />
        ) : null}
        {reauthReady ? (
          <Alert
            type="success"
            showIcon
            title="管理员安全验证已完成，请重新点击确认移除。"
            style={{ marginTop: 16 }}
          />
        ) : null}
        <Space
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 24 }}
        >
          <Button onClick={closeRemove} disabled={removeMutation.isPending}>
            取消
          </Button>
          <Button
            type="primary"
            danger
            loading={removeMutation.isPending}
            disabled={unfinished.isPending || unfinished.isError}
            onClick={() => void submitRemove()}
          >
            确认移除
          </Button>
        </Space>
      </Modal>

      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={handleReauthSuccess}
      />
    </>
  );
};
