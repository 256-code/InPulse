import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Space,
  Spin,
  Typography,
} from "antd";
import { Controller, useForm } from "react-hook-form";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
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
      centered
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={handleCancel}
      title={
        <div className="drawer-header">
          <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            项目是顶层业务容器
          </Text>
          <h2 style={{ margin: "6px 0 0" }}>新建项目</h2>
        </div>
      }
      width={760}
      footer={null}
    >
      <form
        onSubmit={handleSubmit((values) => void handleSubmitForm(values))}
        noValidate
      >
        <Form component={false} layout="vertical" requiredMark={false}>
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
          <Space align="start" size={16} style={{ display: "flex" }}>
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
          </Space>
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
          <Form.Item label="初始项目成员">
            <div className="impact-fieldset">
              <div className="check-list">
                <span className="creator-locked">
                  <Checkbox checked disabled aria-label="创建者（不可取消）">
                    {creatorName}（创建者，不可取消）
                  </Checkbox>
                </span>
                {directory.isPending ? (
                  <div style={{ display: "flex", justifyContent: "center" }}>
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
                ) : (
                  candidates.map((user) => (
                    <div className="member-option" key={user.id}>
                      <Checkbox
                        checked={selectedMemberIds.includes(user.id)}
                        aria-label={`选择成员：${user.name}`}
                        onChange={() => toggleMember(user.id)}
                      />
                      <Avatar size={24} className="person-avatar">
                        {user.name.slice(0, 1)}
                      </Avatar>
                      <span className="member-name">{user.name}</span>
                      <span className="member-role">
                        {user.isAdmin ? "系统管理员" : "项目成员"}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                已选择 {selectedMemberIds.length}{" "}
                位其他成员；创建者自动成为活跃成员，
                系统管理员即使不在成员列表也会自动拥有项目访问权。
              </Text>
            </div>
          </Form.Item>
          <aside className="writing-context">
            <strong>创建规则</strong>
            <dl>
              <dt>创建者</dt>
              <dd>自动成为活跃成员，创建流程中不可取消</dd>
              <dt>编码</dt>
              <dd>创建后不可修改，仅用于溯源</dd>
              <dt>未分类模块</dt>
              <dd>创建成功后自动生成，可继续拆分</dd>
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
        <Space
          className="calm-action-footer"
          style={{ display: "flex", justifyContent: "flex-end" }}
        >
          <Button disabled={mutation.isPending} onClick={handleCancel}>
            取消
          </Button>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            创建项目
          </Button>
        </Space>
      </form>
    </Modal>
  );
};
