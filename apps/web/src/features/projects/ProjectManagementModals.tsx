import React, { useEffect, useState } from "react";
import { Alert, Button, Form, Input, Modal, Space, Typography } from "antd";
import { Controller, useForm } from "react-hook-form";
import type { InpulseApiClient, ProjectItem } from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import { isAdminReauthRequired } from "./project-member-query";
import {
  describeProjectManagementError,
  useArchiveProject,
  useProjectArchivePreview,
  useRestoreProject,
  useUpdateProject,
} from "./project-management-query";
import {
  PROJECT_ARCHIVE_REASON_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  projectArchiveFormSchema,
  projectEditFormSchema,
  projectRestoreFormSchema,
  type ProjectArchiveFormValues,
  type ProjectEditFormValues,
  type ProjectRestoreFormValues,
} from "./project-form";

const { Text } = Typography;

function modalTitle(kicker: string, title: string) {
  return (
    <div className="drawer-header">
      <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
        {kicker}
      </Text>
      <h2 style={{ margin: "6px 0 0" }}>{title}</h2>
    </div>
  );
}

export interface EditProjectModalProps {
  readonly open: boolean;
  readonly project: ProjectItem;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onUpdated: (updated: ProjectItem) => void;
}

/** F-06.1 前端编辑入口；编码不可修改，保存走 If-Match 乐观锁。 */
export const EditProjectModal: React.FC<EditProjectModalProps> = ({
  open,
  project,
  client,
  onClose,
  onUpdated,
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

  useEffect(() => {
    if (open) {
      reset({ name: project.name, description: project.description });
      mutation.reset();
    }
  }, [open, project.id, project.name, project.description]);

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
      centered
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      title={modalTitle("项目活跃成员或系统管理员可编辑", "编辑项目")}
      width={640}
      footer={null}
    >
      <form onSubmit={handleSubmit((values) => void submit(values))} noValidate>
        <Form component={false} layout="vertical" requiredMark={false}>
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
        </Form>
        <Space
          className="calm-action-footer"
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            保存修改
          </Button>
        </Space>
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

/** F-06.2 前端归档入口；归档前展示未完成任务提醒，要求管理员重认证与原因。 */
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
  const preview = useProjectArchivePreview(open ? project.id : null, client);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);

  useEffect(() => {
    if (open) {
      reset({ reason: "" });
      mutation.reset();
      setReauthDone(false);
    }
  }, [open, project.id]);

  useEffect(() => {
    if (mutation.isError && isAdminReauthRequired(mutation.error)) {
      setReauthOpen(true);
      setReauthDone(false);
    }
  }, [mutation.error, mutation.isError]);

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
      centered
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      title={modalTitle(
        "仅系统管理员可执行，需 5 分钟内双因子重认证",
        "归档项目",
      )}
      width={640}
      footer={null}
    >
      <form onSubmit={handleSubmit((values) => void submit(values))} noValidate>
        <Form component={false} layout="vertical" requiredMark={false}>
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
          {reauthDone ? (
            <Alert
              type="success"
              showIcon
              title="管理员安全验证已完成，请重新点击确认归档。"
              style={{ marginTop: 16 }}
            />
          ) : null}
          {mutation.error ? (
            <Alert
              showIcon
              type="error"
              title={describeProjectManagementError(mutation.error, "archive")}
              style={{ marginTop: 16 }}
            />
          ) : null}
        </Form>
        <Space
          className="calm-action-footer"
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button
            danger
            type="primary"
            htmlType="submit"
            loading={mutation.isPending}
          >
            确认归档
          </Button>
        </Space>
      </form>
      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          setReauthDone(true);
        }}
      />
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
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);

  useEffect(() => {
    if (open) {
      reset({ reason: "" });
      mutation.reset();
      setReauthDone(false);
    }
  }, [open, project.id]);

  useEffect(() => {
    if (mutation.isError && isAdminReauthRequired(mutation.error)) {
      setReauthOpen(true);
      setReauthDone(false);
    }
  }, [mutation.error, mutation.isError]);

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
      centered
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={() => {
        if (!mutation.isPending) onClose();
      }}
      title={modalTitle(
        "仅系统管理员可执行，需 5 分钟内双因子重认证",
        "恢复项目",
      )}
      width={640}
      footer={null}
    >
      <form onSubmit={handleSubmit((values) => void submit(values))} noValidate>
        <Form component={false} layout="vertical" requiredMark={false}>
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
          {reauthDone ? (
            <Alert
              type="success"
              showIcon
              title="管理员安全验证已完成，请重新点击确认恢复。"
            />
          ) : null}
          {mutation.error ? (
            <Alert
              showIcon
              type="error"
              title={describeProjectManagementError(mutation.error, "restore")}
              style={{ marginTop: 16 }}
            />
          ) : null}
        </Form>
        <Space
          className="calm-action-footer"
          style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}
        >
          <Button disabled={mutation.isPending} onClick={onClose}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            确认恢复
          </Button>
        </Space>
      </form>
      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          setReauthDone(true);
        }}
      />
    </Modal>
  );
};
