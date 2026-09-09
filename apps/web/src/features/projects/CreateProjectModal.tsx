import React, { useEffect } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  Modal,
  Space,
  Typography,
} from "antd";
import { Controller, useForm } from "react-hook-form";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
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
  const code = watch("code") ?? "";
  const cardShortname = deriveProjectCardShortname(code);

  useEffect(() => {
    if (open) {
      reset(defaultValues);
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
        toCreateProjectRequest(parsed.data),
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

  return (
    <Modal
      centered
      destroyOnHidden
      mask={{ closable: false }}
      open={open}
      onCancel={handleCancel}
      title={
        <div>
          <Text type="secondary" style={{ display: "block", fontSize: 12 }}>
            项目是顶层业务容器
          </Text>
          <span>新建项目</span>
        </div>
      }
      width={720}
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
            <div
              style={{
                border: "1px solid #dce4ee",
                borderRadius: 8,
                padding: "12px 16px",
                background: "#f8fafc",
              }}
            >
              <Checkbox checked disabled>
                {creatorName}（创建者，不可取消）
              </Checkbox>
              <Text
                type="secondary"
                style={{ display: "block", marginTop: 8, fontSize: 12 }}
              >
                当前版本仅支持创建者自动成为初始成员；用户选择入口将在成员查询
                API 就绪后接入。
              </Text>
            </div>
          </Form.Item>
          {mutation.error ? (
            <Alert
              showIcon
              type="error"
              title={describeCreateProjectError(mutation.error)}
              style={{ marginBottom: 16 }}
            />
          ) : null}
        </Form>
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
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
