import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Form, Input, Spin, Typography } from "antd";
import { Controller, useForm } from "react-hook-form";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { AppModal as Modal } from "@features/common/components/AppModal";
import {
  useUserDirectoryQuery,
  describeUserDirectoryError,
} from "@features/users/user-directory-query";
import {
  deriveProjectCardShortname,
  normalizeProjectCode,
  projectFormSchema,
  PROJECT_CODE_MAX_LENGTH,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  PROJECT_NAME_MAX_LENGTH,
  toCreateProjectRequest,
  type ProjectFormValues,
} from "./project-form";
import { describeCreateProjectError, useCreateProject } from "./project-query";

const { Text } = Typography;

export interface CreateProjectModalProps {
  readonly open: boolean;
  readonly creatorName: string;
  readonly creatorUserId?: number | undefined;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onCreated: (response: CreateProjectResponse) => void;
}

const defaultValues: ProjectFormValues = {
  name: "",
  code: "",
  description: "",
};

export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  open,
  creatorName,
  creatorUserId,
  client,
  onClose,
  onCreated,
}) => {
  const {
    control,
    handleSubmit,
    reset,
    watch,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<ProjectFormValues>({
    defaultValues,
    mode: "onSubmit",
  });
  const mutation = useCreateProject({ client });
  const formId = React.useId();
  const directory = useUserDirectoryQuery({ client, enabled: open });
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const code = watch("code") ?? "";
  const cardShortname = deriveProjectCardShortname(code);
  const candidates = useMemo(
    () => (directory.data ?? []).filter((user) => user.id !== creatorUserId),
    [creatorUserId, directory.data],
  );

  useEffect(() => {
    if (open) {
      reset(defaultValues);
      setSelectedMemberIds([]);
      mutation.reset();
    }
  }, [open]);

  const handleSubmitForm = async (values: ProjectFormValues) => {
    const parsed = projectFormSchema.safeParse(values);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "name" || field === "code" || field === "description") {
          setError(field, { message: issue.message });
        }
      }
      return;
    }
    try {
      const response = await mutation.mutateAsync(
        toCreateProjectRequest(parsed.data, selectedMemberIds),
      );
      mutation.reset();
      onCreated(response);
      onClose();
    } catch {
      // 错误由 mutation.error 展示，服务器内部消息不下发到界面。
    }
  };

  const handleCancel = () => {
    if (!mutation.isPending) {
      onClose();
    }
  };

  const toggleMember = (memberId: number) => {
    setSelectedMemberIds((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    );
  };

  return (
    <Modal
      className="catalog-modal"
      eyebrow="项目是顶层业务容器"
      title="新建项目"
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={handleCancel}
      footer={
        <>
          <Button disabled={mutation.isPending} onClick={handleCancel}>
            取消
          </Button>
          <Button
            type="primary"
            htmlType="submit"
            form={formId}
            loading={mutation.isPending}
          >
            创建项目
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="catalog-form catalog-form-create calm-form"
        onSubmit={handleSubmit((values) => void handleSubmitForm(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
          <div className="dialog-form">
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
                    id="project-name"
                    aria-label="项目名称"
                    maxLength={PROJECT_NAME_MAX_LENGTH}
                    placeholder="例如：商城系统"
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      field.onChange(event.currentTarget.value);
                      clearErrors("name");
                    }}
                  />
                </Form.Item>
              )}
            />
            <div className="form-row">
              <Controller
                name="code"
                control={control}
                render={({ field }) => (
                  <Form.Item
                    label="项目编码"
                    required
                    style={{ flex: 1 }}
                    validateStatus={errors.code ? "error" : ""}
                    help={errors.code?.message ?? ""}
                  >
                    <Input
                      {...field}
                      id="project-code"
                      aria-label="项目编码"
                      maxLength={PROJECT_CODE_MAX_LENGTH}
                      placeholder="SHOP"
                      disabled={mutation.isPending}
                      onChange={(event) => {
                        field.onChange(
                          normalizeProjectCode(event.currentTarget.value),
                        );
                        clearErrors("code");
                      }}
                    />
                  </Form.Item>
                )}
              />
              <Form.Item label="卡片简称" style={{ flex: 1 }}>
                <Input
                  id="project-card-shortname"
                  aria-label="卡片简称"
                  value={cardShortname}
                  disabled
                />
              </Form.Item>
            </div>
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
                    id="project-description"
                    aria-label="项目描述"
                    rows={3}
                    maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
                    placeholder="描述项目目标、交付范围与现场背景"
                    disabled={mutation.isPending}
                    onChange={(event) => {
                      field.onChange(event.currentTarget.value);
                      clearErrors("description");
                    }}
                  />
                </Form.Item>
              )}
            />
            <fieldset className="impact-fieldset">
              <legend>初始项目成员</legend>
              <div className="check-list">
                <span className="creator-locked">
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    aria-label="创建者（不可取消）"
                  />
                  {creatorName}（创建者，不可取消）
                </span>
                {!directory.isPending &&
                  !directory.isError &&
                  candidates.map((user) => (
                    <label key={user.id}>
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(user.id)}
                        aria-label={`选择成员：${user.name}`}
                        onChange={() => toggleMember(user.id)}
                      />
                      {user.name} · {user.isAdmin ? "系统管理员" : "项目成员"}
                    </label>
                  ))}
              </div>
              {directory.isPending ? (
                <div className="member-loading">
                  <Spin size="small" description="正在加载成员..." />
                </div>
              ) : directory.isError ? (
                <Alert
                  showIcon
                  type="error"
                  message={describeUserDirectoryError(directory.error)}
                />
              ) : candidates.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无其他启用用户"
                />
              ) : null}
              <Text type="secondary" className="member-hint">
                已选择 {selectedMemberIds.length}{" "}
                位其他成员；创建者自动成为活跃成员，
                系统管理员即使不在成员列表也会自动拥有项目访问权。
              </Text>
            </fieldset>
          </div>
          <aside className="writing-context">
            <strong>创建规则</strong>
            <dl>
              <dt>创建者</dt>
              <dd>自动成为活跃成员，创建流程中不可取消</dd>
              <dt>编码</dt>
              <dd>创建后不可修改，仅用于溯源</dd>
              <dt>模块</dt>
              <dd>按需手动创建，项目也可以没有模块</dd>
              <dt>系统管理员</dt>
              <dd>自动拥有项目访问权，即使不在成员列表</dd>
            </dl>
            <p className="permission-hint">
              项目创建与成员初始化在同一事务中完成，成员创建成功后收到加入通知。
            </p>
          </aside>
          {mutation.error ? (
            <Alert
              showIcon
              type="error"
              title={describeCreateProjectError(mutation.error)}
              style={{ marginBottom: 16 }}
            />
          ) : null}
        </Form>
      </form>
    </Modal>
  );
};
