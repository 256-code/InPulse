import React, { useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Space, Switch } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type AdminUserItem,
  type InpulseApiClient,
} from "@generated/api";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { NotificationPolicyPanel } from "@features/settings/NotificationPolicyPanel";
import { PermissionMatrixPanel } from "@features/settings/PermissionMatrixPanel";
import { adminUserErrorMessage, useAdminUsers } from "./admin-user-query";

type LifecycleAction = "disable" | "enable" | "forceLogout";

/** 设计师稿 latest-version/views/settings.tsx L9-11：左栏区块导航。 */
type SettingsTab = "members" | "permissions" | "notifications";

type EditorValues = {
  readonly name: string;
  readonly email: string;
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

export const AdminUsersPageView: React.FC<AdminUsersPageViewProps> = ({
  client,
  currentUserId,
  onOpenProjects,
}) => {
  const { query, mutation } = useAdminUsers(client);
  const [editor, setEditor] = useState<AdminUserItem | null>(null);
  const [lifecycle, setLifecycle] = useState<{
    action: LifecycleAction;
    user: AdminUserItem;
  } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>("members");
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditorValues>({
    defaultValues: { name: "", email: "", isAdmin: false },
  });

  const openUpdate = (user: AdminUserItem) => {
    setEditor(user);
    setLifecycle(null);
    setSuccess(null);
    setFormError(null);
    setReloadError(null);
    mutation.reset();
    reset({
      name: user.name,
      email: user.email ?? "",
      isAdmin: user.isAdmin,
    });
  };

  const openLifecycle = (action: LifecycleAction, user: AdminUserItem) => {
    setEditor(null);
    setLifecycle({ action, user });
    setSuccess(null);
    setFormError(null);
    setReloadError(null);
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
      const body: {
        name?: string;
        email?: string | null;
        isAdmin?: boolean;
      } = {};
      const name = values.name.trim();
      const email = values.email.trim();
      if (name !== editor.name) body.name = name;
      if (email !== (editor.email ?? ""))
        body.email = email.length === 0 ? null : email;
      if (values.isAdmin !== editor.isAdmin) body.isAdmin = values.isAdmin;
      if (Object.keys(body).length === 0) {
        setFormError("没有需要保存的更改。");
        return;
      }
      await mutation.mutateAsync({ action: "update", user: editor, body });
      setSuccess("用户资料已更新");
      setEditor(null);
      reset();
    } catch {
      // 失败详情由 mutation 状态统一渲染，避免重复提示。
    } finally {
      submitting.current = false;
    }
  });

  const reloadLatest = async () => {
    if (!editor || reloading) return;
    setReloading(true);
    setReloadError(null);
    try {
      const result = await query.refetch();
      if (result.error) {
        setReloadError(adminUserErrorMessage(result.error));
        return;
      }
      const latest = result.data?.items.find((item) => item.id === editor.id);
      if (!latest) {
        setReloadError("用户已不存在，请关闭编辑窗口。");
        return;
      }
      reset({
        name: latest.name,
        email: latest.email ?? "",
        isAdmin: latest.isAdmin,
      });
      setEditor(latest);
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
    } catch {
      // 失败详情由 mutation 状态统一渲染，避免重复提示。
    } finally {
      submitting.current = false;
    }
  };

  const versionConflict =
    mutation.error instanceof ApiError &&
    mutation.error.code === "ADMIN_USER_VERSION_CONFLICT";
  const selfAdmin = (user: AdminUserItem) =>
    currentUserId !== undefined && user.id === currentUserId;

  const selfIsAdmin =
    query.data?.items.find((item) => item.id === currentUserId)?.isAdmin ??
    false;

  // 当前登录账号置顶（便于先确认自身身份与权限），其后是其他系统管理员，最后是普通成员；同组内保持服务端顺序。
  const members = useMemo(() => {
    const items = query.data?.items ?? [];
    const rank = (user: AdminUserItem) => {
      if (currentUserId !== undefined && user.id === currentUserId) return 0;
      return user.isAdmin ? 1 : 2;
    };
    return [...items].sort((left, right) => rank(left) - rank(right));
  }, [query.data, currentUserId]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>成员与设置</h1>
        </div>
        <span className="identity-chip">
          当前身份：{selfIsAdmin ? "系统管理员" : "项目成员"}
        </span>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="成员与设置导航">
          <button
            type="button"
            className={activeTab === "members" ? "selected" : undefined}
            aria-current={activeTab === "members" ? "page" : undefined}
            onClick={() => setActiveTab("members")}
          >
            <InpulseIcon name="users" size={15} />
            成员与角色
          </button>
          {onOpenProjects ? (
            <button type="button" onClick={onOpenProjects}>
              <InpulseIcon name="folder" size={15} />
              项目成员
            </button>
          ) : null}
          <button
            type="button"
            className={activeTab === "permissions" ? "selected" : undefined}
            aria-current={activeTab === "permissions" ? "page" : undefined}
            onClick={() => setActiveTab("permissions")}
          >
            <InpulseIcon name="shield" size={15} />
            权限矩阵
          </button>
          <button
            type="button"
            className={activeTab === "notifications" ? "selected" : undefined}
            aria-current={activeTab === "notifications" ? "page" : undefined}
            onClick={() => setActiveTab("notifications")}
          >
            <InpulseIcon name="bell" size={15} />
            通知策略
          </button>
        </nav>

        {activeTab === "permissions" ? <PermissionMatrixPanel /> : null}
        {activeTab === "notifications" ? <NotificationPolicyPanel /> : null}

        {activeTab === "members" ? (
          <section className="panel settings-panel">
            <CalmSectionTitle
              title="成员与角色"
              hint={
                query.data ? `共 ${members.length} 位成员` : "正在加载成员列表"
              }
            />

            {success ? (
              <div className="permission-note note-success" role="status">
                <InpulseIcon name="check" size={16} />
                <span>{success}</span>
              </div>
            ) : null}

            {query.isPending ? (
              <div className="calm-state">
                <span className="calm-spinner" />
                正在加载用户列表
              </div>
            ) : query.isError ? (
              <CalmEmptyState
                icon="alert"
                title="用户列表加载失败"
                description={adminUserErrorMessage(query.error)}
              >
                <Button
                  className="secondary-button"
                  onClick={() => void query.refetch()}
                >
                  重试
                </Button>
              </CalmEmptyState>
            ) : !members.length ? (
              <CalmEmptyState
                icon="users"
                title="暂无用户"
                description="账号由统一身份认证在首次登录时自动创建，无需在此新增。"
              />
            ) : (
              <div className="member-list">
                {members.map((user) => (
                  <div className="member-row" key={user.id}>
                    <span className="person-avatar">
                      {user.name.trim().charAt(0) || "成"}
                    </span>
                    <div className="member-id">
                      <strong>
                        {user.name}
                        {selfAdmin(user) ? (
                          <span className="member-self">（当前账号）</span>
                        ) : null}
                      </strong>
                      <small>
                        {user.loginName}
                        {user.email ? ` · ${user.email}` : ""}
                      </small>
                    </div>
                    <div className="member-meta">
                      <CalmBadge tone={user.isAdmin ? "blue" : "gray"}>
                        {user.isAdmin ? "系统管理员" : "项目成员"}
                      </CalmBadge>
                      <span
                        className={
                          "member-status" +
                          (user.status === "ACTIVE" ? "" : " is-disabled")
                        }
                      >
                        {user.status === "ACTIVE" ? "启用" : "停用"}
                      </span>
                    </div>
                    <div className="member-actions">
                      <Button
                        className="text-button"
                        onClick={() => openUpdate(user)}
                      >
                        编辑
                      </Button>
                      {!selfAdmin(user) && (
                        <Button
                          className="text-button"
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
                        <Button
                          className="text-button"
                          onClick={() => openLifecycle("forceLogout", user)}
                        >
                          强制退出
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="permission-note">
              <InpulseIcon name="shield" size={16} />
              <span>
                <strong>权限提示</strong>
                系统管理员可以归档项目、作废与恢复记录、查看原始审计快照；高风险操作需要二次确认。项目成员在已加入项目内拥有全部普通研发操作权限。
              </span>
            </div>
          </section>
        ) : null}
      </div>

      <Modal
        className="catalog-modal"
        open={editor !== null}
        eyebrow={editor ? "账号 · " + editor.loginName : "用户目录与本地账号"}
        title="编辑用户"
        body
        onCancel={closeEditor}
        mask={{ closable: !mutation.isPending }}
      >
        <form
          className="admin-user-form"
          onSubmit={(event) => void save(event)}
        >
          <p>
            账号由统一身份认证创建，登录名不可修改；编辑资料、邮箱与管理员角色都会写入审计。
          </p>
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
                  (editor !== null && selfAdmin(editor))
                }
                onChange={field.onChange}
              />
            )}
          />
          <p>
            {editor !== null && selfAdmin(editor)
              ? "不能取消自己当前的管理员角色。"
              : "开启后该账号可执行用户管理、模块归档等管理员操作。"}
          </p>
          {formError && <Alert type="error" title={formError} />}
          {mutation.isError && (
            <Alert type="error" title={adminUserErrorMessage(mutation.error)} />
          )}
          {reloadError && <Alert type="error" title={reloadError} />}
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
        className="catalog-modal"
        open={lifecycle !== null}
        eyebrow={
          lifecycle ? "账号 · " + lifecycle.user.loginName : "账号生命周期"
        }
        title={lifecycle ? lifecycleCopy[lifecycle.action].title : ""}
        // 停用是破坏性动作（红）、强制退出是告警（橙）、启用是挽回（绿）。
        tone={
          lifecycle !== null && lifecycle.action === "enable"
            ? "success"
            : lifecycle !== null && lifecycle.action === "forceLogout"
              ? "warning"
              : "danger"
        }
        icon={
          lifecycle === null || lifecycle.action === "disable"
            ? "alert"
            : lifecycle.action === "forceLogout"
              ? "logout"
              : "check"
        }
        body
        onCancel={closeLifecycle}
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
    </>
  );
};

export interface AdminUsersPageViewProps {
  readonly client?: InpulseApiClient | undefined;
  readonly currentUserId?: number | undefined;
  readonly onOpenProjects?: (() => void) | undefined;
}
