import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Select, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import type {
  InpulseApiClient,
  ProjectMemberReassignmentItem,
  ProjectMemberRecordItem,
} from "@generated/api";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "@features/common/resource-lifecycle";
import {
  describeUserDirectoryError,
  useUserDirectoryQuery,
} from "@features/users/user-directory-query";
import {
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
  /** ADR-033：当前登录用户是否系统管理员（可转移/撤销组长）。 */
  readonly isSystemAdmin?: boolean | undefined;
  /**
   * 嵌在项目主页弹窗内：项目已由外层固定，隐藏页内的项目切换器
   * （切换器依赖整页路由，弹窗内无法生效）。
   */
  readonly embedded?: boolean | undefined;
}

const formatMemberDate = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

const roleLabel: Record<"MEMBER" | "LEADER", string> = {
  MEMBER: "成员",
  LEADER: "组长",
};

export const ProjectMembersPageView: React.FC<ProjectMembersPageViewProps> = ({
  projectId,
  client,
  isSystemAdmin = false,
  embedded = false,
}) => {
  const { query, addMutation, removeMutation, roleMutation } =
    useProjectMembers(projectId, client);
  const directory = useUserDirectoryQuery({ client });
  const [addOpen, setAddOpen] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<readonly number[]>([]);
  const [removing, setRemoving] = useState<ProjectMemberRecordItem | null>(
    null,
  );
  const [reassignChoices, setReassignChoices] = useState<
    Readonly<Record<number, ReassignmentChoice>>
  >({});
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
  const openAdd = () => {
    setAddOpen(true);
    setSelectedUserIds([]);
    setActionError(null);
    setSuccess(null);
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
    removeMutation.reset();
  };

  const closeRemove = () => {
    if (removeMutation.isPending) return;
    setRemoving(null);
    removeMutation.reset();
  };

  // ADR-039：项目内角色任命只剩「任命/撤销组长」，且只能由系统管理员执行。
  const assignableRoles = ["MEMBER", "LEADER"] as const;
  const [roleTarget, setRoleTarget] = useState<ProjectMemberRecordItem | null>(
    null,
  );
  const [selectedRole, setSelectedRole] = useState<"MEMBER" | "LEADER" | null>(
    null,
  );

  const openRoleModal = (member: ProjectMemberRecordItem) => {
    setRoleTarget(member);
    setSelectedRole(member.role === "LEADER" ? null : member.role);
    setActionError(null);
    setSuccess(null);
    roleMutation.reset();
  };

  const closeRoleModal = () => {
    if (roleMutation.isPending) return;
    setRoleTarget(null);
    setSelectedRole(null);
    roleMutation.reset();
  };

  const submitRole = async () => {
    if (roleTarget === null || selectedRole === null) return;
    if (roleMutation.isPending) return;
    setActionError(null);
    try {
      await roleMutation.mutateAsync({
        userId: roleTarget.userId,
        role: selectedRole,
      });
      setSuccess(
        `已将 ${roleTarget.name} 的项目角色设置为${roleLabel[selectedRole]}。`,
      );
      setRoleTarget(null);
      setSelectedRole(null);
    } catch (error) {
      setActionError(projectMemberErrorMessage(error));
    }
  };

  const submitAdd = async () => {
    if (selectedUserIds.length === 0 || addMutation.isPending) return;
    setActionError(null);
    try {
      const { added, failures } = await addMutation.mutateAsync({
        userIds: selectedUserIds,
      });
      if (failures.length === 0) {
        setAddOpen(false);
        setSuccess(`已添加 ${added.length} 位项目成员，项目成员列表已更新。`);
        return;
      }
      // 后端一次只接受一个用户，逐个提交后汇总：失败的用户保留勾选，
      // 修正原因后可以直接重试，已加入的成员不再重复选择。
      const [firstFailure] = failures;
      const reason = projectMemberErrorMessage(firstFailure?.error);
      setSelectedUserIds(failures.map((failure) => failure.userId));
      if (added.length === 0) {
        setActionError(reason);
        return;
      }
      setSuccess(`已添加 ${added.length} 位项目成员，项目成员列表已更新。`);
      setActionError(`其余 ${failures.length} 位成员添加失败：${reason}`);
    } catch (error) {
      setActionError(projectMemberErrorMessage(error));
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
      setActionError(projectMemberErrorMessage(error));
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
      {embedded ? null : (
        <div className="page-header">
          <div>
            <h1>{project ? project.name : "项目成员管理"}</h1>
            <p>
              本项目任意活跃成员都可添加或移除项目成员；
              移除不会删除任何历史数据，未改派任务保留原负责人，
              但原成员将立即失去处理权限。
            </p>
          </div>
          {project ? (
            <div className="catalog-actions">
              <CalmBadge tone={projectLifecycleTone(project.status, "blue")}>
                {projectLifecycleLabel(project.status)}
              </CalmBadge>
            </div>
          ) : null}
        </div>
      )}

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
      ) : activeMembers.length === 0 ? (
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
              hint="本项目任意活跃成员都可以添加或移除成员"
            >
              {embedded ? null : (
                <CalmSelect
                  value={projectId}
                  onChange={(next) =>
                    navigate("/projects/" + String(next) + "/members")
                  }
                  options={(projects.data?.items ?? []).map((item) => ({
                    value: item.id,
                    label: item.name,
                    description: String(item.memberCount) + " 名活跃成员",
                    iconText: item.code.slice(0, 2).toUpperCase(),
                    badge: {
                      text: projectLifecycleLabel(item.status),
                      tone: projectLifecycleTone(item.status, "blue"),
                    },
                  }))}
                  appearance="rich"
                  ariaLabel="选择项目"
                />
              )}
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
                <dd>{projectLifecycleLabel(project.status)}</dd>
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
                {/* 2026-09-23：只展示活跃成员，已移除成员不再出现在列表里；
                    成员关系仍按 REMOVED 保留在库中，重新加入走「添加成员」。 */}
                <div className="member-history-list">
                  {activeMembers.map((member) => (
                    <article
                      key={member.membershipId}
                      className="calm-member-card"
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
                        </div>
                      </div>
                      <div className="member-status">
                        <CalmBadge tone="green">活跃成员</CalmBadge>
                        {member.role !== "MEMBER" ? (
                          <CalmBadge tone="blue">
                            {roleLabel[member.role]}
                          </CalmBadge>
                        ) : null}
                      </div>
                      <div className="member-card-actions">
                        {isSystemAdmin ? (
                          <Button
                            className="secondary-button"
                            onClick={() => openRoleModal(member)}
                          >
                            设置角色
                          </Button>
                        ) : null}
                        {member.role !== "LEADER" ? (
                          <Button
                            className="danger-button"
                            onClick={() => openRemove(member)}
                          >
                            移除
                          </Button>
                        ) : null}
                      </div>
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
                      project.status === "ARCHIVED" ? "restore" : "archive",
                    )
                  }
                >
                  <InpulseIcon name="folder" size={15} />
                  {project.status === "ARCHIVED" ? "恢复项目" : "归档项目"}
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
              disabled={selectedUserIds.length === 0}
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
              description="已被移出的用户仍在候选目录中，重新选择即可再次加入；停用用户不会出现在目录中。"
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
              <div className="calm-field">
                <label htmlFor="project-member-candidate">选择用户</label>
                <CalmSelect
                  id="project-member-candidate"
                  ariaLabel="选择要添加的用户"
                  appearance="member"
                  multiple
                  value={selectedUserIds}
                  onChange={(next) => setSelectedUserIds(next.map(Number))}
                  placeholder="输入姓名搜索，可一次选择多位启用用户"
                  options={addCandidates.map((user) => ({
                    value: user.id,
                    label: user.name,
                    avatarUrl: user.avatarUrl ?? null,
                    description: user.isAdmin ? "系统管理员" : "启用用户",
                  }))}
                />
                {selectedUserIds.length > 1 ? (
                  <p className="member-hint">
                    已选择 {selectedUserIds.length}{" "}
                    位用户，确认后一次性加入项目。
                  </p>
                ) : null}
              </div>
            )}
            {actionError ? (
              <Alert type="error" showIcon title={actionError} />
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        className="catalog-modal"
        open={removing !== null}
        eyebrow={project ? project.name + " / 成员管理" : "项目成员"}
        title="移除项目成员"
        tone="danger"
        icon="alert"
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
          </div>
        </div>
      </Modal>

      <Modal
        className="catalog-modal"
        open={roleTarget !== null}
        eyebrow={project ? project.name + " / 成员管理" : "项目成员"}
        title="设置项目角色"
        onCancel={closeRoleModal}
        mask={{ closable: !roleMutation.isPending }}
        footer={
          <>
            <Button
              className="secondary-button"
              onClick={closeRoleModal}
              disabled={roleMutation.isPending}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              loading={roleMutation.isPending}
              disabled={
                selectedRole === null ||
                selectedRole === (roleTarget?.role ?? null)
              }
              onClick={() => void submitRole()}
            >
              保存角色
            </Button>
          </>
        }
      >
        <div className="catalog-form">
          <div className="dialog-form">
            <Alert
              showIcon
              type="info"
              title={
                "为 " +
                (roleTarget?.name ?? "") +
                " 设置项目内角色（仅在本项目生效）"
              }
              description={
                "可将成员设为组长或撤销组长；每个项目只能有一名组长，转移组长后原组长自动成为普通成员。"
              }
            />
            <div className="impact-fieldset member-candidate-list">
              <div className="check-list">
                {assignableRoles.map((role) => (
                  <label key={role}>
                    <input
                      type="radio"
                      name="project-member-role"
                      checked={selectedRole === role}
                      aria-label={"项目角色：" + roleLabel[role]}
                      onChange={() => setSelectedRole(role)}
                    />
                    {roleLabel[role]}
                    {role === "LEADER"
                      ? "（每项目唯一，仅作身份标识，管理权限与成员相同）"
                      : "（普通项目成员）"}
                  </label>
                ))}
              </div>
            </div>
            {actionError ? (
              <Alert type="error" showIcon title={actionError} />
            ) : null}
          </div>
        </div>
      </Modal>

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
