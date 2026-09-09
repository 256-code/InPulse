import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Switch,
  Tag,
} from "antd";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type AdminUserItem,
  type InpulseApiClient,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  adminUserErrorMessage,
  useAdminUsers,
  type AdminUserChange,
} from "./admin-user-query";

type EditorState =
  | { readonly mode: "create" }
  | { readonly mode: "update"; readonly user: AdminUserItem };

type LifecycleAction = "disable" | "enable" | "forceLogout";

type EditorValues = {
  readonly loginName: string;
  readonly name: string;
  readonly email: string;
  readonly avatarUrl: string;
  readonly password: string;
  readonly isAdmin: boolean;
};

const lifecycleCopy: Readonly<
  Record<LifecycleAction, { title: string; description: string }>
> = {
  disable: {
    title: "停用用户",
    description: "停用后将撤销该用户全部会话并记录审计；历史数据不会删除。",
  },
  enable: {
    title: "启用用户",
    description: "启用后用户可重新登录；历史与已撤销会话不会恢复。",
  },
  forceLogout: {
    title: "强制退出",
    description: "将立即撤销该用户全部会话并记录审计，账号保持启用状态。",
  },
};

function isAdminReauthRequired(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    (error as { readonly status: unknown }).status === 403 &&
    (error as { readonly code: unknown }).code === "ADMIN_REAUTH_REQUIRED"
  );
}

export const AdminUsersPageView: React.FC<AdminUsersPageViewProps> = ({
  client,
  currentUserId,
}) => {
  const { query, mutation } = useAdminUsers(client);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [lifecycle, setLifecycle] = useState<{
    action: LifecycleAction;
    user: AdminUserItem;
  } | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthReady, setReauthReady] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditorValues>({
    defaultValues: {
      loginName: "",
      name: "",
      email: "",
      avatarUrl: "",
      password: "",
      isAdmin: false,
    },
  });

  useEffect(() => {
    if (mutation.isError && isAdminReauthRequired(mutation.error)) {
      setReauthOpen(true);
    }
  }, [mutation.error, mutation.isError]);

  const openCreate = () => {
    setEditor({ mode: "create" });
    setLifecycle(null);
    setSuccess(null);
    setFormError(null);
    setReloadError(null);
    setReauthReady(false);
    mutation.reset();
    reset({
      loginName: "",
      name: "",
      email: "",
      avatarUrl: "",
      password: "",
      isAdmin: false,
    });
  };

  const openUpdate = (user: AdminUserItem) => {
    setEditor({ mode: "update", user });
    setLifecycle(null);
    setSuccess(null);
    setFormError(null);
    setReloadError(null);
    setReauthReady(false);
    mutation.reset();
    reset({
      loginName: user.loginName,
      name: user.name,
      email: user.email ?? "",
      avatarUrl: user.avatarUrl ?? "",
      password: "",
      isAdmin: user.isAdmin,
    });
  };

  const openLifecycle = (action: LifecycleAction, user: AdminUserItem) => {
    setEditor(null);
    setLifecycle({ action, user });
    setSuccess(null);
    setFormError(null);
    setReloadError(null);
    setReauthReady(false);
    mutation.reset();
  };

  const closeEditor = () => {
    if (submitting.current) return;
    setEditor(null);
    setFormError(null);
    setReloadError(null);
    mutation.reset();
  };

  const closeLifecycle = () => {
    if (submitting.current) return;
    setLifecycle(null);
    mutation.reset();
  };

  const save = handleSubmit(async (values) => {
    if (!editor || submitting.current) return;
    submitting.current = true;
    setFormError(null);
    try {
      let change: AdminUserChange;
      if (editor.mode === "create") {
        const body: {
          loginName: string;
          name: string;
          password: string;
          isAdmin: boolean;
          email?: string;
          avatarUrl?: string;
        } = {
          loginName: values.loginName.trim(),
          name: values.name.trim(),
          password: values.password,
          isAdmin: values.isAdmin,
        };
        if (values.email.trim()) body.email = values.email.trim();
        if (values.avatarUrl.trim()) body.avatarUrl = values.avatarUrl.trim();
        change = { action: "create", body };
      } else {
        const user = editor.user;
        const body: {
          name?: string;
          email?: string | null;
          avatarUrl?: string | null;
          isAdmin?: boolean;
        } = {};
        const name = values.name.trim();
        const email = values.email.trim();
        const avatarUrl = values.avatarUrl.trim();
        if (name !== user.name) body.name = name;
        if (email !== (user.email ?? ""))
          body.email = email.length === 0 ? null : email;
        if (avatarUrl !== (user.avatarUrl ?? ""))
          body.avatarUrl = avatarUrl.length === 0 ? null : avatarUrl;
        if (values.isAdmin !== user.isAdmin) body.isAdmin = values.isAdmin;
        if (Object.keys(body).length === 0) {
          setFormError("没有需要保存的更改。");
          return;
        }
        change = { action: "update", user, body };
      }
      await mutation.mutateAsync(change);
      setSuccess(editor.mode === "create" ? "用户创建成功" : "用户资料已更新");
      setEditor(null);
      reset();
    } catch (error) {
      if (isAdminReauthRequired(error)) {
        setReauthOpen(true);
      }
    } finally {
      submitting.current = false;
    }
  });

  const reloadLatest = async () => {
    if (!editor || editor.mode !== "update" || reloading) return;
    setReloading(true);
    setReloadError(null);
    try {
      const result = await query.refetch();
      if (result.error) {
        setReloadError(adminUserErrorMessage(result.error));
        return;
      }
      const latest = result.data?.items.find(
        (item) => item.id === editor.user.id,
      );
      if (!latest) {
        setReloadError("用户已不存在，请关闭编辑窗口。");
        return;
      }
      reset({
        loginName: latest.loginName,
        name: latest.name,
        email: latest.email ?? "",
        avatarUrl: latest.avatarUrl ?? "",
        password: "",
        isAdmin: latest.isAdmin,
      });
      setEditor({ mode: "update", user: latest });
      mutation.reset();
      setFormError(null);
    } finally {
      setReloading(false);
    }
  };

  const confirmLifecycle = async () => {
    if (!lifecycle || submitting.current) return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({
        action: lifecycle.action,
        user: lifecycle.user,
      });
      setSuccess(
        lifecycle.action === "disable"
          ? "用户已停用"
          : lifecycle.action === "enable"
            ? "用户已启用"
            : "已强制退出该用户",
      );
      setLifecycle(null);
    } catch (error) {
      if (isAdminReauthRequired(error)) {
        setReauthOpen(true);
      }
    } finally {
      submitting.current = false;
    }
  };

  const editorTitle =
    editor?.mode === "create"
      ? "新增用户"
      : editor?.mode === "update"
        ? "编辑用户"
        : "";
  const versionConflict =
    mutation.error instanceof ApiError &&
    mutation.error.code === "ADMIN_USER_VERSION_CONFLICT";
  const selfAdmin = (user: AdminUserItem) =>
    currentUserId !== undefined && user.id === currentUserId;

  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">系统管理员</span>
          <h1>用户管理</h1>
          <p>
            新增、编辑、启停与强制退出用户账号；所有写操作均需安全重认证并留痕。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新增用户
        </Button>
      </div>
      <Space orientation="vertical" style={{ width: "100%" }} size={16}>
        {success && <Alert type="success" showIcon title={success} />}
        {query.isPending ? (
          <Spin description="正在加载用户列表" />
        ) : query.isError ? (
          <Alert
            type="error"
            title={adminUserErrorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        ) : !query.data?.items.length ? (
          <Empty description="暂无用户" />
        ) : (
          query.data.items.map((user) => (
            <Card
              key={user.id}
              title={
                <Space wrap>
                  <span>{user.name}</span>
                  <Tag>{user.loginName}</Tag>
                  <Tag color="blue">{user.isAdmin ? "管理员" : "成员"}</Tag>
                  <Tag color={user.status === "ACTIVE" ? "green" : "default"}>
                    {user.status === "ACTIVE" ? "正常" : "已停用"}
                  </Tag>
                  {selfAdmin(user) && <Tag color="gold">当前账号</Tag>}
                </Space>
              }
              extra={
                <Space wrap>
                  <Button onClick={() => openUpdate(user)}>编辑</Button>
                  {!selfAdmin(user) && (
                    <Button
                      onClick={() =>
                        openLifecycle(
                          user.status === "ACTIVE" ? "disable" : "enable",
                          user,
                        )
                      }
                    >
                      {user.status === "ACTIVE" ? "停用" : "启用"}
                    </Button>
                  )}
                  {!selfAdmin(user) && (
                    <Button onClick={() => openLifecycle("forceLogout", user)}>
                      强制退出
                    </Button>
                  )}
                </Space>
              }
            >
              <p>
                <strong>邮箱：</strong>
                {user.email ?? "未绑定"}
              </p>
              <p>
                <strong>头像：</strong>
                {user.avatarUrl ?? "未设置"}
              </p>
              <p>
                <strong>更新时间：</strong>
                {new Date(user.updatedAt).toLocaleString("zh-CN", {
                  hour12: false,
                })}
              </p>
              {user.status === "DISABLED" && (
                <p>停用用户的历史与资料仍保留；重新启用不会恢复旧会话。</p>
              )}
            </Card>
          ))
        )}
      </Space>

      <Modal
        open={editor !== null}
        title={editorTitle}
        onCancel={closeEditor}
        footer={null}
        mask={{ closable: !mutation.isPending }}
      >
        <form onSubmit={(event) => void save(event)}>
          {editor?.mode === "update" && (
            <p>
              登录名创建后不可修改；编辑资料、邮箱、头像与管理员角色都会写入审计。
            </p>
          )}
          {editor?.mode === "create" && (
            <>
              <label htmlFor="admin-user-login-name">登录名</label>
              <Controller
                name="loginName"
                control={control}
                rules={{
                  validate: (value) =>
                    value.trim().length > 0 || "请填写登录名",
                  maxLength: { value: 100, message: "登录名最多 100 字" },
                }}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="admin-user-login-name"
                    disabled={mutation.isPending || reloading}
                  />
                )}
              />
              <p role="alert">{errors.loginName?.message}</p>
            </>
          )}
          <label htmlFor="admin-user-name">姓名</label>
          <Controller
            name="name"
            control={control}
            rules={{
              validate: (value) => value.trim().length > 0 || "请填写姓名",
              maxLength: { value: 200, message: "姓名最多 200 字" },
            }}
            render={({ field }) => (
              <Input
                {...field}
                id="admin-user-name"
                disabled={mutation.isPending || reloading}
              />
            )}
          />
          <p role="alert">{errors.name?.message}</p>
          <label htmlFor="admin-user-email">邮箱</label>
          <Controller
            name="email"
            control={control}
            rules={{ maxLength: { value: 320, message: "邮箱最多 320 字" } }}
            render={({ field }) => (
              <Input
                {...field}
                id="admin-user-email"
                disabled={mutation.isPending || reloading}
                placeholder="可选"
              />
            )}
          />
          <p role="alert">{errors.email?.message}</p>
          <label htmlFor="admin-user-avatar">头像地址</label>
          <Controller
            name="avatarUrl"
            control={control}
            rules={{
              maxLength: { value: 2048, message: "头像地址最多 2048 字" },
            }}
            render={({ field }) => (
              <Input
                {...field}
                id="admin-user-avatar"
                disabled={mutation.isPending || reloading}
                placeholder="可选"
              />
            )}
          />
          <p role="alert">{errors.avatarUrl?.message}</p>
          {editor?.mode === "create" && (
            <>
              <label htmlFor="admin-user-password">初始密码</label>
              <Controller
                name="password"
                control={control}
                rules={{
                  validate: (value) => value.length > 0 || "请填写初始密码",
                  maxLength: { value: 1024, message: "密码最多 1024 字" },
                }}
                render={({ field }) => (
                  <Input.Password
                    {...field}
                    id="admin-user-password"
                    disabled={mutation.isPending || reloading}
                    autoComplete="new-password"
                  />
                )}
              />
              <p role="alert">{errors.password?.message}</p>
            </>
          )}
          <label>管理员角色</label>
          <Controller
            name="isAdmin"
            control={control}
            render={({ field }) => (
              <Switch
                {...field}
                aria-label="管理员角色"
                checked={field.value}
                disabled={
                  mutation.isPending ||
                  reloading ||
                  (editor?.mode === "update" && selfAdmin(editor.user))
                }
                onChange={field.onChange}
              />
            )}
          />
          <p>
            {editor?.mode === "update" && selfAdmin(editor.user)
              ? "不能取消自己当前的管理员角色。"
              : "开启后该账号登录时需完成 TOTP MFA 注册。"}
          </p>
          {formError && <Alert type="error" title={formError} />}
          {mutation.isError && (
            <Alert type="error" title={adminUserErrorMessage(mutation.error)} />
          )}
          {reloadError && <Alert type="error" title={reloadError} />}
          {reauthReady && (
            <Alert
              type="success"
              title="管理员安全验证已完成，请重新提交当前操作。"
            />
          )}
          {versionConflict && (
            <Button loading={reloading} onClick={() => void reloadLatest()}>
              加载最新版本后继续编辑
            </Button>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button onClick={closeEditor} disabled={mutation.isPending}>
              取消
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={reloading || !!versionConflict}
            >
              保存
            </Button>
          </Space>
        </form>
      </Modal>

      <Modal
        open={lifecycle !== null}
        title={lifecycle ? lifecycleCopy[lifecycle.action].title : ""}
        onCancel={closeLifecycle}
        footer={null}
        mask={{ closable: !mutation.isPending }}
      >
        {lifecycle && (
          <>
            <p>{lifecycleCopy[lifecycle.action].description}</p>
            <p>
              目标用户：{lifecycle.user.name}（{lifecycle.user.loginName}）
            </p>
            {mutation.isError && (
              <Alert
                type="error"
                title={adminUserErrorMessage(mutation.error)}
              />
            )}
            {reauthReady && (
              <Alert
                type="success"
                title="管理员安全验证已完成，请重新提交当前操作。"
              />
            )}
            <Space style={{ marginTop: 16 }}>
              <Button onClick={closeLifecycle} disabled={mutation.isPending}>
                取消
              </Button>
              <Button
                type="primary"
                loading={mutation.isPending}
                onClick={() => void confirmLifecycle()}
              >
                确认
              </Button>
            </Space>
          </>
        )}
      </Modal>

      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          setReauthReady(true);
          mutation.reset();
        }}
      />
    </>
  );
};

export interface AdminUsersPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly currentUserId?: number | undefined;
}
