import React, { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Modal,
  Space,
  Spin,
  Tag,
} from "antd";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type InpulseApiClient,
  type ModuleItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  moduleErrorMessage,
  useModules,
  type ModuleChange,
} from "./module-query";

type Values = { name: string; description: string; reason: string };
const editableFields = ["name", "description"] as const;
type EditableField = (typeof editableFields)[number];
const fieldLabels = { name: "模块名称", description: "模块说明" };
type Merge = {
  base: ModuleItem;
  draft: Values;
  latest: ModuleItem;
  values: Values;
  conflicts: EditableField[];
  choices: Partial<Record<EditableField, "draft" | "latest">>;
};
export function ModulesPageView({
  projectId,
  isAdmin,
  client,
}: {
  projectId: number;
  isAdmin: boolean;
  client?: InpulseApiClient | undefined;
}) {
  const { query, mutation } = useModules(projectId, client);
  const [selection, setSelection] = useState<{
    action: ModuleChange["action"];
    item?: ModuleItem;
  } | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [merge, setMerge] = useState<Merge | null>(null);
  const editGeneration = useRef(0);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { name: "", description: "", reason: "" },
  });
  const open = (action: ModuleChange["action"], item?: ModuleItem) => {
    editGeneration.current += 1;
    setMerge(null);
    setSelection({ action, ...(item ? { item } : {}) });
    reset({
      name: item?.name ?? "",
      description: item?.description ?? "",
      reason: "",
    });
    mutation.reset();
    setReloadError(null);
    setSuccess(false);
  };
  const save = handleSubmit(async (values) => {
    if (
      !selection ||
      submitting.current ||
      reloading ||
      merge ||
      conflict ||
      reloadError
    )
      return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({ ...selection, ...values });
      setSelection(null);
      setSuccess(true);
      reset();
    } catch {
      /* Mutation retains the error and form remains mounted. */
    } finally {
      submitting.current = false;
    }
  });
  const reload = async () => {
    const generation = editGeneration.current;
    const draft = getValues();
    setReloading(true);
    try {
      const latest = await query.refetch();
      if (generation !== editGeneration.current) return;
      if (latest.error) {
        setReloadError(moduleErrorMessage(latest.error));
        return;
      }
      if (selection?.item) {
        const item = latest.data?.items.find(
          (value) => value.id === selection.item!.id,
        );
        if (!item) {
          setReloadError("模块已不可访问，请取消编辑。");
          return;
        }
        if (selection.action === "update") {
          if (item.status !== "ACTIVE") {
            setReloadError(
              "模块已归档，草稿已保留，请取消编辑并在恢复后重试。",
            );
            return;
          }
          const values = { ...draft };
          const conflicts: EditableField[] = [];
          for (const field of editableFields) {
            // Compare the name as the request schema normalizes it.
            const normalize = (value: string) =>
              field === "name" ? value.trim() : value;
            const original = normalize(selection.item[field]);
            const mine = normalize(draft[field]);
            const theirs = normalize(item[field]);
            if (mine === original) values[field] = item[field];
            else if (theirs !== original && mine !== theirs)
              conflicts.push(field);
          }
          if (conflicts.length) {
            setMerge({
              base: selection.item,
              draft,
              latest: item,
              values,
              conflicts,
              choices: {},
            });
            setReloadError(null);
            return;
          }
          reset(values);
        }
        setSelection({ ...selection, item });
      }
      mutation.reset();
      setReloadError(null);
    } finally {
      setReloading(false);
    }
  };
  const applyMerge = () => {
    if (
      !merge ||
      !selection ||
      merge.conflicts.some((field) => !merge.choices[field])
    )
      return;
    const values = { ...merge.values };
    for (const field of merge.conflicts) {
      values[field] =
        merge.choices[field] === "draft"
          ? merge.draft[field]
          : merge.latest[field];
    }
    reset(values);
    setSelection({ ...selection, item: merge.latest });
    setMerge(null);
    mutation.reset();
  };
  const close = () => {
    if (submitting.current) return;
    editGeneration.current += 1;
    setSelection(null);
    setMerge(null);
  };
  const lifecycle =
    selection?.action === "archive" || selection?.action === "restore";
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  return (
    <>
      <div className="page-header">
        <div>
          <span className="eyebrow">项目内模块</span>
          <h1>模块管理</h1>
          <p>维护模块名称、说明和归档状态。未分类模块可编辑，身份保持不变。</p>
        </div>
        <Button
          type="primary"
          disabled={!query.data || query.isError}
          onClick={() => open("create")}
        >
          新建模块
        </Button>
      </div>
      <Space orientation="vertical" style={{ width: "100%" }} size={16}>
        <Alert
          type="info"
          showIcon
          title="当前提供模块管理；功能档案、任务和记录入口将在对应功能交付后开放。"
        />
        {success && <Alert type="success" showIcon title="模块操作成功" />}
        {query.isPending ? (
          <Spin description="正在加载模块" />
        ) : query.isError ? (
          <Alert
            type="error"
            title={moduleErrorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        ) : !query.data?.items.length ? (
          <Empty description="暂无模块" />
        ) : (
          query.data.items.map((item) => (
            <Card
              key={item.id}
              title={
                <Space wrap>
                  <span>{item.name}</span>
                  {item.kind === "UNCLASSIFIED" && <Tag>未分类</Tag>}
                  <Tag color={item.status === "ACTIVE" ? "green" : "default"}>
                    {item.status === "ACTIVE" ? "正常" : "已归档"}
                  </Tag>
                </Space>
              }
              extra={
                <Space>
                  {item.status === "ACTIVE" && (
                    <Button onClick={() => open("update", item)}>编辑</Button>
                  )}
                  {isAdmin && (
                    <Button
                      onClick={() =>
                        open(
                          item.status === "ACTIVE" ? "archive" : "restore",
                          item,
                        )
                      }
                    >
                      {item.status === "ACTIVE" ? "归档" : "恢复"}
                    </Button>
                  )}
                </Space>
              }
            >
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {item.description || "暂无模块说明"}
              </p>
              {item.kind === "UNCLASSIFIED" && (
                <p>
                  该模块由项目创建流程生成，允许修改名称与说明，不可删除或改变未分类身份。
                </p>
              )}
              {item.status === "ARCHIVED" && (
                <p>归档历史仍可查看；恢复前不能在此模块新增下级内容。</p>
              )}
            </Card>
          ))
        )}
      </Space>
      <Modal
        open={selection !== null}
        title={
          selection?.action === "create"
            ? "新建模块"
            : selection?.action === "update"
              ? "编辑模块"
              : selection?.action === "archive"
                ? "归档模块"
                : "恢复模块"
        }
        onCancel={close}
        footer={null}
        mask={{ closable: !mutation.isPending }}
      >
        <form onSubmit={(event) => void save(event)}>
          {lifecycle ? (
            <>
              <p>
                {selection?.action === "archive"
                  ? "归档后模块及下级内容不可写，历史将保留。"
                  : "恢复模块本身的可写状态，不改变下级资源各自的归档状态。"}
              </p>
              <label htmlFor="module-reason">操作原因</label>
              <Controller
                name="reason"
                control={control}
                rules={{
                  validate: (v) => v.trim().length > 0 || "请填写操作原因",
                  maxLength: { value: 2000, message: "原因最多 2000 字" },
                }}
                render={({ field }) => (
                  <Input.TextArea
                    {...field}
                    id="module-reason"
                    disabled={mutation.isPending || reloading || !!merge}
                    rows={3}
                  />
                )}
              />
              <p role="alert">{errors.reason?.message}</p>
              <Button
                onClick={() => setReauthOpen(true)}
                disabled={mutation.isPending || reloading || conflict}
              >
                管理员安全验证
              </Button>
            </>
          ) : (
            <>
              <label htmlFor="module-name">模块名称</label>
              <Controller
                name="name"
                control={control}
                rules={{
                  validate: (v) => v.trim().length > 0 || "请填写模块名称",
                  maxLength: { value: 200, message: "名称最多 200 字" },
                }}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="module-name"
                    disabled={mutation.isPending || reloading || !!merge}
                  />
                )}
              />
              <p role="alert">{errors.name?.message}</p>
              <label htmlFor="module-description">模块说明</label>
              <Controller
                name="description"
                control={control}
                rules={{
                  maxLength: { value: 20000, message: "说明最多 20000 字" },
                }}
                render={({ field }) => (
                  <Input.TextArea
                    {...field}
                    id="module-description"
                    rows={5}
                    disabled={mutation.isPending || reloading || !!merge}
                  />
                )}
              />
              <p role="alert">{errors.description?.message}</p>
            </>
          )}
          {mutation.isError && (
            <Alert type="error" title={moduleErrorMessage(mutation.error)} />
          )}
          {reloadError && <Alert type="error" title={reloadError} />}
          {merge && (
            <section aria-label="解决编辑冲突">
              {merge.conflicts.map((field) => (
                <div key={field}>
                  <h3>{fieldLabels[field]}存在冲突</h3>
                  <dl
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    <dt>编辑前</dt>
                    <dd>{merge.base[field] || "（空）"}</dd>
                    <dt>我的草稿</dt>
                    <dd>{merge.draft[field] || "（空）"}</dd>
                    <dt>服务端最新</dt>
                    <dd>{merge.latest[field] || "（空）"}</dd>
                  </dl>
                  <Space wrap>
                    <Button
                      aria-pressed={merge.choices[field] === "draft"}
                      onClick={() =>
                        setMerge({
                          ...merge,
                          choices: { ...merge.choices, [field]: "draft" },
                        })
                      }
                    >
                      保留我的{fieldLabels[field]}
                    </Button>
                    <Button
                      aria-pressed={merge.choices[field] === "latest"}
                      onClick={() =>
                        setMerge({
                          ...merge,
                          choices: { ...merge.choices, [field]: "latest" },
                        })
                      }
                    >
                      采用最新{fieldLabels[field]}
                    </Button>
                  </Space>
                </div>
              ))}
              <Button
                disabled={merge.conflicts.some(
                  (field) => !merge.choices[field],
                )}
                onClick={applyMerge}
              >
                应用合并结果
              </Button>
            </section>
          )}
          {conflict && !merge && (
            <Button loading={reloading} onClick={() => void reload()}>
              加载最新版本后继续编辑
            </Button>
          )}
          <Space style={{ marginTop: 16 }}>
            <Button onClick={close} disabled={mutation.isPending}>
              取消
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={reloading || conflict || !!reloadError || !!merge}
            >
              {lifecycle ? "确认" : "保存"}
            </Button>
          </Space>
        </form>
      </Modal>
      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          mutation.reset();
        }}
      />
    </>
  );
}
