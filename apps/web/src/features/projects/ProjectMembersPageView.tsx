import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Select, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import type {
  InpulseApiClient,
  ProjectMemberReassignmentItem,
  ProjectMemberRecordItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
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
import { useProjects } from "./project-query";
import {
  ArchiveProjectModal,
  RestoreProjectModal,
} from "./ProjectManagementModals";

interface ReassignmentChoice {
  readonly enabled: boolean;
  readonly assigneeId?: number | undefined;
}

export interface ProjectMembersPageViewProps {
  readonly projectId: number;
  readonly client?: InpulseApiClient | undefined;
}

const formatMemberDate = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

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
  const [dangerAction, setDangerAction] = useState<
    "archive" | "restore" | null
  >(null);
  const projects = useProjects({ client });
  const navigate = useNavigate();
  const project = (projects.data?.items ?? []).find(
    (item) => item.id === projectId,
  );

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
  const memberNames = useMemo(
    () =>
      new Map(
        (query.data?.items ?? []).map((item) => [item.userId, item.name]),
      ),
    [query.data],
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
        setActionError("请为任务 " + task.code + " 选择改派成员。");
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
          <span className="eyebrow">项目 / 成员与设置</span>
          <h1>{project ? project.name : "项目成员管理"}</h1>
          <p>
            系统管理员可添加或移除项目成员；移除不会删除任何历史数据，
            未改派任务保留原负责人，但原成员将立即失去处理权限。
          </p>
        </div>
        {project ? (
          <div className="catalog-actions">
            <CalmBadge tone={project.status === "ACTIVE" ? "blue" : "amber"}>
              {project.status === "ACTIVE" ? "正常" : "已归档"}
            </CalmBadge>
          </div>
        ) : null}
      </div>

      {success ? (
        <Alert
          className="member-success"
          type="success"
          showIcon
          title={success}
        />
      ) : null}

      {query.isPending ? (
        <div className="calm-state">
          <span className="calm-spinner" />
          <span>正在加载项目成员</span>
        </div>
      ) : query.isError ? (
        <CalmEmptyState
          icon="alert"
          title="项目成员加载失败"
          description={projectMemberErrorMessage(query.error)}
        >
          <Button
            className="secondary-button"
            onClick={() => void query.refetch()}
          >
            重试
          </Button>
        </CalmEmptyState>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <CalmEmptyState
          icon="users"
          title="暂无项目成员"
          description="添加成员后，成员关系、任务历史与审计记录都会保留在项目内。"
        >
          <Button className="primary-button" onClick={openAdd}>
            <InpulseIcon name="plus" size={15} />
            添加成员
          </Button>
        </CalmEmptyState>
      ) : (
        <section className="panel settings-panel">
          <div className="settings-panel-head">
            <CalmSectionTitle
              title="项目成员"
              hint="只有系统管理员可以添加或移除成员"
            >
              <select
                aria-label="选择项目"
                value={projectId}
                onChange={(event) =>
                  navigate(`/projects/${event.target.value}/members`)
                }
              >
                {(projects.data?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </CalmSectionTitle>
          </div>
          {project ? (
            <>
              <dl className="calm-meta project-facts">
                <dt>项目编码</dt>
                <dd>
                  <code>{project.code}</code>（创建后不可修改）
                </dd>
                <dt>状态</dt>
                <dd>{project.status === "ACTIVE" ? "正常" : "已归档"}</dd>
                <dt>创建人</dt>
                <dd>
                  {memberNames.get(project.createdBy) ?? "—"}
                  （仅溯源，不授予额外权限）
                </dd>
                <dt>创建时间</dt>
                <dd>{formatMemberDate(project.createdAt)}</dd>
                <dt>当前成员</dt>
                <dd>
                  {activeMembers.map((member) => member.name).join("、") || "—"}
                </dd>
              </dl>

              <div className="member-editor">
                <div className="member-selection-top">
                  <strong>调整成员</strong>
                  <Button className="secondary-button" onClick={openAdd}>
                    <InpulseIcon name="plus" size={15} />
                    添加成员
                  </Button>
                </div>
                <div className="member-history-list">
                  {[...(query.data?.items ?? [])].map((member) => (
                    <article
                      key={member.membershipId}
                      className={
                        "calm-member-card" +
                        (member.status === "REMOVED"
                          ? " member-card-removed"
                          : "")
                      }
                    >
                      <div className="calm-member-card-main">
                        <span className="person-avatar member-avatar">
                          {member.name.slice(0, 1)}
                        </span>
                        <div className="member-identity">
                          <strong>
                            {member.name}
                            {member.userId === project.createdBy
                              ? "（创建者）"
                              : ""}
                          </strong>
                          <span>
                            加入时间：{formatMemberDate(member.joinedAt)}
                          </span>
                          {member.removedAt ? (
                            <span>
                              移除时间：{formatMemberDate(member.removedAt)}
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="member-status">
                        <CalmBadge
                          tone={member.status === "ACTIVE" ? "green" : "gray"}
                        >
                          {member.status === "ACTIVE" ? "活跃成员" : "已移除"}
                        </CalmBadge>
                        {member.status === "REMOVED" ? (
                          <small>历史记录已保留</small>
                        ) : null}
                      </div>
                      <div className="member-card-actions">
                        {member.status === "ACTIVE" ? (
                          <Button
                            className="danger-button"
                            onClick={() => openRemove(member)}
                          >
                            移除
                          </Button>
                        ) : null}
                      </div>
                      {member.status === "REMOVED" ? (
                        <p className="member-removed-note">
                          <InpulseIcon name="clock" size={14} />
                          <span>
                            已移除成员的历史任务、记录和审计均保留，可重新加入。
                          </span>
                        </p>
                      ) : null}
                    </article>
                  ))}
                </div>
                <div className="calm-action-footer">
                  <Button
                    className="secondary-button"
                    onClick={() => {
                      void query.refetch();
                    }}
                  >
                    刷新成员
                  </Button>
                </div>
                <p className="permission-hint">
                  <InpulseIcon name="shield" size={15} />
                  <span>
                    移除创建者只关闭成员关系，不会修改永久保留的创建人字段；
                    已完成任务保留原负责人，已发布记录保留原作者，
                    未完成任务需要提示是否改派。
                  </span>
                </p>
              </div>

              <div className="danger-zone">
                <strong>高风险操作</strong>
                <p>
                  归档后项目不再接受新的写入，历史数据全部保留；恢复后按普通项目继续。
                </p>
                <Button
                  className="danger-button"
                  onClick={() =>
                    setDangerAction(
                      project.status === "ACTIVE" ? "archive" : "restore",
                    )
                  }
                >
                  <InpulseIcon name="folder" size={15} />
                  {project.status === "ACTIVE" ? "归档项目" : "恢复项目"}
                </Button>
              </div>
            </>
          ) : null}
        </section>
      )}

      <Modal
        className="catalog-modal"
        open={addOpen}
        eyebrow={project ? project.name + " / 成员管理" : "项目成员"}
        title="添加项目成员"
        onCancel={closeAdd}
        mask={{ closable: !addMutation.isPending }}
        footer={
          <>
            <Button
              className="secondary-button"
              onClick={closeAdd}
              disabled={addMutation.isPending}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              loading={addMutation.isPending}
              disabled={selectedUserId === null}
              onClick={() => void submitAdd()}
            >
              添加成员
            </Button>
          </>
        }
      >
        <div className="catalog-form">
          <div className="dialog-form">
            <Alert
              showIcon
              type="info"
              title="添加后该用户将成为项目活跃成员"
              description="系统管理员可在成员历史中重新加入已移除用户；停用用户不会出现在目录中。"
            />
            {directory.isPending ? (
              <div className="calm-state modal-loading">
                <Spin size="small" />
                <span>正在加载用户目录</span>
              </div>
            ) : directory.isError ? (
              <Alert
                type="error"
                showIcon
                title={describeUserDirectoryError(directory.error)}
              />
            ) : addCandidates.length === 0 ? (
              <CalmEmptyState
                icon="users"
                title="没有可添加的启用用户"
                description="请先在用户目录中启用用户，再回来添加项目成员。"
              />
            ) : (
              <div className="impact-fieldset member-candidate-list">
                <div className="check-list">
                  {addCandidates.map((user) => (
                    <label key={user.id}>
                      <input
                        type="checkbox"
                        checked={selectedUserId === user.id}
                        aria-label={"选择成员：" + user.name}
                        onChange={(event) =>
                          setSelectedUserId(
                            event.target.checked ? user.id : null,
                          )
                        }
                      />
                      {user.name} · {user.isAdmin ? "系统管理员" : "启用用户"}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {actionError ? (
              <Alert type="error" showIcon title={actionError} />
            ) : null}
            {reauthReady ? (
              <Alert
                type="success"
                showIcon
                title="管理员安全验证已完成，请重新点击添加。"
              />
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        className="catalog-modal"
        open={removing !== null}
        eyebrow={project ? project.name + " / 成员管理" : "项目成员"}
        title="移除项目成员"
        onCancel={closeRemove}
        mask={{ closable: !removeMutation.isPending }}
        footer={
          <>
            <Button
              className="secondary-button"
              onClick={closeRemove}
              disabled={removeMutation.isPending}
            >
              取消
            </Button>
            <Button
              className="primary-button danger-button"
              loading={removeMutation.isPending}
              disabled={unfinished.isPending || unfinished.isError}
              onClick={() => void submitRemove()}
            >
              确认移除
            </Button>
          </>
        }
      >
        <div className="catalog-form">
          <div className="dialog-form">
            <Alert
              showIcon
              type="warning"
              title={"确认从项目中移除 " + (removing?.name ?? "") + "？"}
              description="成员历史、已完成任务和审计记录均保留；未完成任务可选择改派，否则保留原负责人但该成员不能继续处理。"
            />
            <CalmSectionTitle
              title="未完成任务"
              hint="勾选改派后必须选择其他活跃成员；不勾选则保留原负责人。"
            />
            {unfinished.isPending ? (
              <div className="calm-state modal-loading">
                <Spin size="small" />
                <span>正在检查未完成任务</span>
              </div>
            ) : unfinished.isError ? (
              <Alert
                type="error"
                showIcon
                title={projectMemberErrorMessage(unfinished.error)}
              />
            ) : (unfinished.data?.items.length ?? 0) === 0 ? (
              <Alert type="success" showIcon title="该成员没有未完成任务。" />
            ) : (
              <div className="member-task-list">
                {[...(unfinished.data?.items ?? [])].map((task) => {
                  const choice = reassignChoices[task.taskId];
                  return (
                    <div className="calm-member-task-card" key={task.taskId}>
                      <div className="member-task-main">
                        <strong>{task.code}</strong>
                        <span>{task.title}</span>
                      </div>
                      <div className="check-list">
                        <label>
                          <input
                            type="checkbox"
                            checked={choice?.enabled === true}
                            aria-label={"改派任务 " + task.code}
                            onChange={(event) =>
                              disabledTaskReassignment(
                                task.taskId,
                                event.target.checked,
                              )
                            }
                          />
                          改派给其他活跃成员
                        </label>
                      </div>
                      {choice?.enabled ? (
                        <Select
                          aria-label={"选择 " + task.code + " 的改派成员"}
                          value={choice.assigneeId ?? undefined}
                          placeholder="选择改派成员"
                          options={assigneeOptions}
                          disabled={assigneeOptions.length === 0}
                          onChange={(value) => {
                            if (value !== undefined) {
                              setReassignmentAssignee(task.taskId, value);
                            }
                          }}
                        />
                      ) : (
                        <span className="member-task-keep">
                          <InpulseIcon name="user" size={14} />
                          保留原负责人
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {actionError ? (
              <Alert type="error" showIcon title={actionError} />
            ) : null}
            {reauthReady ? (
              <Alert
                type="success"
                showIcon
                title="管理员安全验证已完成，请重新点击确认移除。"
              />
            ) : null}
          </div>
        </div>
      </Modal>

      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={handleReauthSuccess}
      />

      {project && dangerAction === "archive" ? (
        <ArchiveProjectModal
          open
          project={project}
          client={client}
          onClose={() => setDangerAction(null)}
          onArchived={() => {
            setDangerAction(null);
            void projects.refetch();
            setSuccess("项目已归档，历史数据全部保留。");
          }}
        />
      ) : null}
      {project && dangerAction === "restore" ? (
        <RestoreProjectModal
          open
          project={project}
          client={client}
          onClose={() => setDangerAction(null)}
          onRestored={() => {
            setDangerAction(null);
            void projects.refetch();
            setSuccess("项目已恢复，可按普通项目继续使用。");
          }}
        />
      ) : null}
    </>
  );
};
