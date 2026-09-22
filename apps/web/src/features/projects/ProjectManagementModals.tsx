import React, { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Space, Typography } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { CalmBadge, CalmSegmented } from "@features/common/components/Calm";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "@features/common/resource-lifecycle";
import { Controller, useForm } from "react-hook-form";
import type {
  InpulseApiClient,
  ProjectArchiveRequestItem,
  ProjectItem,
  ProjectListItem,
} from "@generated/api";
import {
  describeProjectArchiveRequestError,
  describeProjectManagementError,
  useApproveProjectArchive,
  useArchiveProject,
  useChangeProjectStatus,
  useProjectArchivePreview,
  useRejectProjectArchive,
  useRequestProjectArchive,
  useRestoreProject,
  useUpdateProject,
} from "./project-management-query";
import {
  PROJECT_ARCHIVE_NOTE_MAX_LENGTH,
  PROJECT_ARCHIVE_REASON_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  projectArchiveFormSchema,
  projectArchiveRejectionFormSchema,
  projectEditFormSchema,
  projectRestoreFormSchema,
  type ProjectArchiveFormValues,
  type ProjectArchiveRejectionFormValues,
  type ProjectEditFormValues,
  type ProjectRestoreFormValues,
} from "./project-form";

const { Text } = Typography;

/** ADR-035：可手动切换的三个目标状态，归档不在其中。 */
export type ProjectLifecycleTarget = "NOT_STARTED" | "ACTIVE" | "MAINTENANCE";

export interface EditProjectModalProps {
  readonly open: boolean;
  readonly project: ProjectItem;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onUpdated: (updated: ProjectItem) => void;
  /**
   * ADR-039：调用方按「系统管理员或本项目任意活跃成员」判定后传入，
   * 默认 false 只展示当前状态标签。服务端仍会二次校验同一条件。
   */
  readonly canChangeStatus?: boolean | undefined;
  /** 状态保存成功且不关闭弹窗时通知调用方刷新列表与版本。 */
  readonly onStatusChanged?: ((updated: ProjectItem) => void) | undefined;
}

/** F-06.1 前端编辑入口；编码不可修改，保存走 If-Match 乐观锁。 */
export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  open,
  project,
  client,
  onClose,
  onUpdated,
  canChangeStatus = false,
  onStatusChanged,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ProjectEditFormValues>({
    defaultValues: { name: project.name, description: project.description },
  });
  const mutation = useUpdateProject(project.id, client);
  const statusMutation = useChangeProjectStatus(project.id, client);
  const formId = React.useId();
  const [statusDraft, setStatusDraft] = useState<ProjectLifecycleTarget | null>(
    null,
  );

  useEffect(() => {
    if (open) {
      reset({ name: project.name, description: project.description });
      mutation.reset();
      setStatusDraft(null);
      statusMutation.reset();
    }
  }, [open, project.id, project.name, project.description]);

  const statusLocked = project.status === "ARCHIVED";
  const canEditStatus = canChangeStatus && !statusLocked;
  const currentStatus: ProjectLifecycleTarget = statusLocked
    ? "ACTIVE"
    : (project.status as ProjectLifecycleTarget);
  const statusValue = statusDraft ?? currentStatus;
  const statusDirty = statusValue !== currentStatus;

  const statusOptions = (
    [
      { value: "NOT_STARTED", label: "未开始" },
      { value: "ACTIVE", label: "进行中" },
      { value: "MAINTENANCE", label: "维护中" },
    ] as const
  ).map((option) => {
    const backToNotStarted = option.value === "NOT_STARTED";
    const skipLevel =
      (backToNotStarted && project.status === "MAINTENANCE") ||
      (option.value === "MAINTENANCE" && project.status === "NOT_STARTED");
    const blockedByCompletedTask = backToNotStarted && project.hasCompletedTask;
    return {
      value: option.value,
      label: option.label,
      disabled: blockedByCompletedTask || skipLevel,
      title: blockedByCompletedTask
        ? "项目里已经出现过已完成任务，不能再退回未开始"
        : skipLevel
          ? "未开始与维护中不能直接互相切换，请先切到进行中"
          : undefined,
    };
  });

  const statusHint = statusLocked
    ? "项目已归档，状态只读；请先恢复项目，恢复后状态为进行中。"
    : !canChangeStatus
      ? "只有本项目活跃成员或系统管理员可以更改项目状态。"
      : "未开始 ⇄ 进行中 ⇄ 维护中；未开始与维护中不能直接互改。" +
        (project.hasCompletedTask
          ? "项目里已有完成任务，因此不能再退回未开始。"
          : "");

  const submitStatus = async () => {
    if (!canEditStatus || !statusDirty) return;
    try {
      const updated = await statusMutation.mutateAsync({
        status: statusValue,
        rowVersion: project.rowVersion,
      });
      setStatusDraft(null);
      onStatusChanged?.(updated.project);
    } catch {
      // statusMutation.error 负责展示，草稿保留。
    }
  };

  const submit = async (values: ProjectEditFormValues) => {
    const parsed = projectEditFormSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "description") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    try {
      const updated = await mutation.mutateAsync({
        edit: {
          name: parsed.data.name,
          description: parsed.data.description,
        },
        rowVersion: project.rowVersion,
      });
      onUpdated(updated.project);
      onClose();
    } catch {
      // mutation.error 负责展示，表单保留输入。
    }
  };

  return (
    <Modal
      className="catalog-modal"
      eyebrow="项目活跃成员或系统管理员可编辑"
      title="编辑项目"
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form={formId}
            loading={mutation.isPending}
          >
            保存修改
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form calm-form"
        onSubmit={handleSubmit((values) => void submit(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
            <Form.Item label="项目编码">
              <Input value={project.code} disabled aria-label="项目编码" />
            </Form.Item>
            <Controller
              name="name"
              control={control}
              render={({ field }) => (
                <Form.Item
                  label="项目名称"
                  required
                  validateStatus={errors.name ? "error" : ""}
                  help={errors.name?.message ?? ""}
                >
                  <Input
                    {...field}
                    aria-label="项目名称"
                    maxLength={PROJECT_NAME_MAX_LENGTH}
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      field.onChange(event.currentTarget.value);
                      clearErrors("name");
                    }}
                  />
                </Form.Item>
              )}
            />
            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <Form.Item
                  label="项目描述"
                  validateStatus={errors.description ? "error" : ""}
                  help={errors.description?.message ?? ""}
                >
                  <Input.TextArea
                    {...field}
                    aria-label="项目描述"
                    rows={4}
                    maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      field.onChange(event.currentTarget.value);
                      clearErrors("description");
                    }}
                  />
                </Form.Item>
              )}
            />
            <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
              编码创建后不可修改，仅用于溯源；保存成功后项目版本递增，
              其他页面的编辑需要重新加载最新版本。
            </Text>
            {mutation.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectManagementError(mutation.error, "update")}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </div>
          <div className="dialog-form project-status-section">
            <Form.Item label="项目状态">
              <div className="project-status-control">
                {canEditStatus ? (
                  <CalmSegmented
                    label="项目状态"
                    value={statusValue}
                    options={statusOptions}
                    onChange={(next) => {
                      statusMutation.reset();
                      setStatusDraft(next);
                    }}
                  />
                ) : (
                  <CalmBadge
                    tone={projectLifecycleTone(project.status, "blue")}
                  >
                    {projectLifecycleLabel(project.status)}
                  </CalmBadge>
                )}
                <Button
                  htmlType="button"
                  className="secondary-button"
                  data-testid="save-project-status"
                  disabled={!canEditStatus || !statusDirty}
                  loading={statusMutation.isPending}
                  onClick={() => void submitStatus()}
                >
                  保存状态
                </Button>
              </div>
            </Form.Item>
            <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
              {statusHint}
            </Text>
            {statusMutation.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectManagementError(
                  statusMutation.error,
                  "status",
                )}
                style={{ marginTop: 16 }}
              />
            ) : null}
            {statusMutation.isSuccess && !statusDirty ? (
              <Text
                data-testid="project-status-saved"
                style={{ display: "block", marginTop: 8, fontSize: 12 }}
              >
                状态已更新为「{projectLifecycleLabel(project.status)}」。
              </Text>
            ) : null}
          </div>
        </Form>
      </form>
    </Modal>
  );
};

export interface ArchiveProjectModalProps {
  readonly open: boolean;
  readonly project: ProjectItem;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onArchived: (updated: ProjectItem) => void;
}

/** F-06.2 前端归档入口；归档前展示未完成任务提醒，要求管理员身份与原因。 */
export const ArchiveProjectModal: React.FC<ArchiveProjectModalProps> = ({
  open,
  project,
  client,
  onClose,
  onArchived,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProjectArchiveFormValues>({ defaultValues: { reason: "" } });
  const mutation = useArchiveProject(project.id, client);
  const formId = React.useId();
  const preview = useProjectArchivePreview(open ? project.id : null, client);
  useEffect(() => {
    if (open) {
      reset({ reason: "" });
      mutation.reset();
    }
  }, [open, project.id]);

  const submit = async (values: ProjectArchiveFormValues) => {
    const parsed = projectArchiveFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("reason", {
        message: parsed.error.issues[0]?.message ?? "请填写归档原因",
      });
      return;
    }
    try {
      const updated = await mutation.mutateAsync({
        reason: parsed.data.reason,
        rowVersion: project.rowVersion,
      });
      onArchived(updated.project);
      onClose();
    } catch {
      // mutation.error 负责展示，原因输入保留。
    }
  };

  return (
    <Modal
      className="catalog-modal"
      eyebrow="仅系统管理员可执行"
      title="归档项目"
      tone="danger"
      icon="alert"
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            danger
            type="primary"
            htmlType="submit"
            form={formId}
            loading={mutation.isPending}
          >
            确认归档
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form calm-form"
        onSubmit={handleSubmit((values) => void submit(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {preview.isPending ? (
                <Alert showIcon type="info" title="正在检查未完成任务..." />
              ) : null}
              {preview.isError ? (
                <Alert
                  showIcon
                  type="warning"
                  title="未能读取未完成任务数量"
                  description="归档后项目及全部下级数据只读；历史仍可查看。"
                  action={
                    <Button size="small" onClick={() => void preview.refetch()}>
                      重试
                    </Button>
                  }
                />
              ) : null}
              {preview.data ? (
                preview.data.unfinishedTaskCount > 0 ? (
                  <Alert
                    showIcon
                    type="warning"
                    title={`该项目仍有 ${preview.data.unfinishedTaskCount} 个未完成任务`}
                    description="归档后项目及全部下级数据只读，历史仍可查看；请确认这些任务已妥善安排。"
                  />
                ) : (
                  <Alert
                    showIcon
                    type="info"
                    title="该项目当前没有未完成任务"
                    description="归档后项目及全部下级数据只读，历史仍可查看。"
                  />
                )
              ) : null}
              <Controller
                name="reason"
                control={control}
                render={({ field }) => (
                  <Form.Item
                    label="归档原因"
                    required
                    validateStatus={errors.reason ? "error" : ""}
                    help={errors.reason?.message ?? ""}
                  >
                    <Input.TextArea
                      {...field}
                      aria-label="归档原因"
                      rows={3}
                      maxLength={PROJECT_ARCHIVE_REASON_MAX_LENGTH}
                      placeholder="说明为何归档，原因会写入不可变审计"
                      disabled={mutation.isPending}
                    />
                  </Form.Item>
                )}
              />
            </Space>
            {mutation.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectManagementError(
                  mutation.error,
                  "archive",
                )}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </div>
        </Form>
      </form>
    </Modal>
  );
};

export interface RestoreProjectModalProps {
  readonly open: boolean;
  readonly project: ProjectItem;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onRestored: (updated: ProjectItem) => void;
}

/** F-06.3 前端恢复入口；只恢复项目自身状态，不改变下级数据。 */
export const RestoreProjectModal: React.FC<RestoreProjectModalProps> = ({
  open,
  project,
  client,
  onClose,
  onRestored,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProjectRestoreFormValues>({ defaultValues: { reason: "" } });
  const mutation = useRestoreProject(project.id, client);
  const formId = React.useId();
  useEffect(() => {
    if (open) {
      reset({ reason: "" });
      mutation.reset();
    }
  }, [open, project.id]);

  const submit = async (values: ProjectRestoreFormValues) => {
    const parsed = projectRestoreFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("reason", {
        message: parsed.error.issues[0]?.message ?? "请填写恢复原因",
      });
      return;
    }
    try {
      const updated = await mutation.mutateAsync({
        reason: parsed.data.reason,
        rowVersion: project.rowVersion,
      });
      onRestored(updated.project);
      onClose();
    } catch {
      // mutation.error 负责展示，原因输入保留。
    }
  };

  return (
    <Modal
      className="catalog-modal"
      eyebrow="仅系统管理员可执行"
      title="恢复项目"
      tone="success"
      icon="rotateCcw"
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form={formId}
            loading={mutation.isPending}
          >
            确认恢复
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form calm-form"
        onSubmit={handleSubmit((values) => void submit(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
            <Alert
              showIcon
              type="info"
              title="恢复只恢复项目自身状态"
              description="项目及下级数据重新可写；下级资源各自的归档状态保持不变。"
            />
            <Controller
              name="reason"
              control={control}
              render={({ field }) => (
                <Form.Item
                  label="恢复原因"
                  required
                  validateStatus={errors.reason ? "error" : ""}
                  help={errors.reason?.message ?? ""}
                  style={{ marginTop: 16 }}
                >
                  <Input.TextArea
                    {...field}
                    aria-label="恢复原因"
                    rows={3}
                    maxLength={PROJECT_ARCHIVE_REASON_MAX_LENGTH}
                    placeholder="说明为何恢复，原因会写入不可变审计"
                    disabled={mutation.isPending}
                  />
                </Form.Item>
              )}
            />
            {mutation.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectManagementError(
                  mutation.error,
                  "restore",
                )}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </div>
        </Form>
      </form>
    </Modal>
  );
};

export interface RequestProjectArchiveModalProps {
  readonly open: boolean;
  readonly project: ProjectListItem;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onRequested: (request: ProjectArchiveRequestItem) => void;
}

/**
 * ADR-034/ADR-039：本项目任意活跃成员或系统管理员发起归档申请；申请只进入待审状态，
 * 只有系统管理员批准后项目才会归档。
 */
export const RequestProjectArchiveModal: React.FC<
  RequestProjectArchiveModalProps
> = ({ open, project, client, onClose, onRequested }) => {
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProjectArchiveFormValues>({ defaultValues: { reason: "" } });
  const mutation = useRequestProjectArchive(project.id, client);
  const formId = React.useId();

  useEffect(() => {
    if (open) {
      reset({ reason: "" });
      mutation.reset();
    }
  }, [open, project.id]);

  const submit = async (values: ProjectArchiveFormValues) => {
    const parsed = projectArchiveFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("reason", {
        message: parsed.error.issues[0]?.message ?? "请填写归档申请原因",
      });
      return;
    }
    try {
      const created = await mutation.mutateAsync({
        reason: parsed.data.reason,
      });
      onRequested(created);
      onClose();
    } catch {
      // mutation.error 负责展示，原因输入保留。
    }
  };

  return (
    <Modal
      className="catalog-modal"
      eyebrow="本项目活跃成员可发起"
      title="申请项目归档"
      tone="warning"
      icon="alert"
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form={formId}
            loading={mutation.isPending}
          >
            提交归档申请
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form calm-form"
        onSubmit={handleSubmit((values) => void submit(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              <Alert
                showIcon
                type="info"
                title="申请需要系统管理员审核"
                description="项目下全部任务归档后才能申请；批准后项目及全部下级数据只读，历史仍可查看。"
              />
              <Controller
                name="reason"
                control={control}
                render={({ field }) => (
                  <Form.Item
                    label="归档申请原因"
                    required
                    validateStatus={errors.reason ? "error" : ""}
                    help={errors.reason?.message ?? ""}
                  >
                    <Input.TextArea
                      {...field}
                      aria-label="归档申请原因"
                      rows={3}
                      maxLength={PROJECT_ARCHIVE_REASON_MAX_LENGTH}
                      placeholder="说明为何需要归档，原因会写入不可变审计"
                      disabled={mutation.isPending}
                    />
                  </Form.Item>
                )}
              />
            </Space>
            {mutation.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectArchiveRequestError(
                  mutation.error,
                  "request",
                )}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </div>
        </Form>
      </form>
    </Modal>
  );
};

export interface ReviewProjectArchiveModalProps {
  readonly open: boolean;
  readonly project: ProjectListItem;
  readonly decision: "approve" | "reject";
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onApproved: (project: ProjectItem) => void;
  readonly onRejected: (request: ProjectArchiveRequestItem) => void;
}

/**
 * ADR-034：系统管理员审核项目归档申请；批准时按 If-Match 版本归档项目，
 * 驳回只结束申请、不改变项目状态。
 */
export const ReviewProjectArchiveModal: React.FC<
  ReviewProjectArchiveModalProps
> = ({ open, project, decision, client, onClose, onApproved, onRejected }) => {
  const approve = useApproveProjectArchive(project.id, client);
  const reject = useRejectProjectArchive(project.id, client);
  const {
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ProjectArchiveRejectionFormValues>({
    defaultValues: { note: "" },
  });
  const formId = React.useId();
  const pending = project.pendingArchiveRequest;
  const busy = approve.isPending || reject.isPending;

  useEffect(() => {
    if (open) {
      reset({ note: "" });
      approve.reset();
      reject.reset();
    }
  }, [open, project.id, pending?.id]);

  const submit = async (values: ProjectArchiveRejectionFormValues) => {
    if (!pending) return;
    if (decision === "approve") {
      try {
        const detail = await approve.mutateAsync({
          requestId: pending.id,
          rowVersion: project.rowVersion,
        });
        onApproved(detail.project);
        onClose();
      } catch {
        // approve.error 负责展示。
      }
      return;
    }
    const parsed = projectArchiveRejectionFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("note", {
        message: parsed.error.issues[0]?.message ?? "批注不能超过 2000 个字符",
      });
      return;
    }
    try {
      const rejected = await reject.mutateAsync({
        requestId: pending.id,
        note: parsed.data.note,
      });
      onRejected(rejected);
      onClose();
    } catch {
      // reject.error 负责展示，批注输入保留。
    }
  };

  const reviewing = decision === "approve" ? approve : reject;

  return (
    <Modal
      className="catalog-modal"
      eyebrow="仅系统管理员可执行"
      title={decision === "approve" ? "批准项目归档" : "驳回项目归档申请"}
      tone={decision === "approve" ? "danger" : "info"}
      icon={decision === "approve" ? "alert" : "x"}
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            danger={decision === "approve"}
            type="primary"
            htmlType="submit"
            form={formId}
            loading={busy}
          >
            {decision === "approve" ? "确认归档" : "确认驳回"}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form calm-form"
        onSubmit={handleSubmit((values) => void submit(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {pending ? (
                <Alert
                  showIcon
                  type="warning"
                  title={pending.requestedByName + " 提交了归档申请"}
                  description={pending.reason}
                />
              ) : (
                <Alert
                  showIcon
                  type="warning"
                  title="该申请已被处理"
                  description="请刷新项目列表查看最新状态。"
                />
              )}
              {decision === "approve" ? (
                <Alert
                  showIcon
                  type="info"
                  title={
                    "批准后项目立即归档（当前版本 " + project.rowVersion + "）"
                  }
                  description="项目及全部下级数据只读，历史仍可查看；如需再次编辑请先恢复项目。"
                />
              ) : (
                <Controller
                  name="note"
                  control={control}
                  render={({ field }) => (
                    <Form.Item
                      label="驳回批注（可选）"
                      validateStatus={errors.note ? "error" : ""}
                      help={errors.note?.message ?? ""}
                    >
                      <Input.TextArea
                        {...field}
                        aria-label="驳回批注"
                        rows={3}
                        maxLength={PROJECT_ARCHIVE_NOTE_MAX_LENGTH}
                        placeholder="说明驳回原因，会记录到审计并通知申请人"
                        disabled={busy}
                      />
                    </Form.Item>
                  )}
                />
              )}
            </Space>
            {reviewing.error ? (
              <Alert
                showIcon
                type="error"
                title={describeProjectArchiveRequestError(
                  reviewing.error,
                  decision,
                )}
                style={{ marginTop: 16 }}
              />
            ) : null}
          </div>
        </Form>
      </form>
    </Modal>
  );
};
