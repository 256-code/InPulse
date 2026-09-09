import { SimilarFeatures } from "./SimilarFeatures";
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
  type FeatureItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import {
  featureErrorMessage,
  useFeatures,
  type FeatureChange,
} from "./feature-query";

type Values = {
  name: string;
  currentBehavior: string;
  reason: string;
  tags: string;
};
const editableFields = ["name", "currentBehavior", "tags"] as const;
type EditableField = (typeof editableFields)[number];
const fieldLabels = {
  name: "功能名称",
  currentBehavior: "当前功能说明",
  tags: "标签",
};
type Merge = {
  base: FeatureItem;
  draft: Values;
  latest: FeatureItem;
  values: Values;
  conflicts: EditableField[];
  choices: Partial<Record<EditableField, "draft" | "latest">>;
};
const fieldValue = (item: FeatureItem, field: EditableField): string =>
  field === "tags" ? item.tags.join("\n") : item[field];
export function FeaturesPageView({
  projectId,
  moduleId,
  featureId,
  isAdmin,
  client,
}: {
  projectId: number;
  moduleId: number;
  featureId?: number | undefined;
  isAdmin: boolean;
  client?: InpulseApiClient | undefined;
}) {
  const { query, mutation } = useFeatures(
    projectId,
    moduleId,
    featureId,
    client,
  );
  const [selection, setSelection] = useState<{
    action: FeatureChange["action"];
    item?: FeatureItem;
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
    watch,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { name: "", currentBehavior: "", reason: "", tags: "" },
  });
  const open = (action: FeatureChange["action"], item?: FeatureItem) => {
    editGeneration.current += 1;
    setMerge(null);
    setSelection({ action, ...(item ? { item } : {}) });
    reset({
      name: item?.name ?? "",
      currentBehavior: item?.currentBehavior ?? "",
      reason: "",
      tags: item?.tags.join("\n") ?? "",
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
        setReloadError(featureErrorMessage(latest.error));
        return;
      }
      if (selection?.item) {
        const item = latest.data?.items.find(
          (value) => value.id === selection.item!.id,
        );
        if (!item) {
          setReloadError("功能已不可访问，请取消编辑。");
          return;
        }
        if (selection.action === "update") {
          if (item.status !== "ACTIVE") {
            setReloadError(
              "功能已归档，草稿已保留，请取消编辑并在恢复后重试。",
            );
            return;
          }
          const values = { ...draft };
          const conflicts: EditableField[] = [];
          for (const field of editableFields) {
            // Compare the name as the request schema normalizes it.
            const normalize = (value: string) =>
              field === "name" ? value.trim() : value;
            const original = normalize(fieldValue(selection.item, field));
            const mine = normalize(draft[field]);
            const theirs = normalize(fieldValue(item, field));
            if (mine === original) values[field] = fieldValue(item, field);
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
          : fieldValue(merge.latest, field);
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
      <Space>
        <Button href={`/projects/${projectId}/modules`}>返回模块列表</Button>
        {featureId && (
          <Button href={`/projects/${projectId}/modules/${moduleId}/features`}>
            返回功能列表
          </Button>
        )}
      </Space>
      <div className="page-header">
        <div>
          <span className="eyebrow">
            项目 {projectId} / 模块 {moduleId}
          </span>
          <h1>{featureId ? "功能详情" : "功能档案"}</h1>
          <p>维护长期功能档案，说明修改会保留审计历史。</p>
        </div>
        <Button
          type="primary"
          disabled={!query.data || query.isError}
          onClick={() => open("create")}
        >
          新建功能
        </Button>
      </div>
      <Space orientation="vertical" style={{ width: "100%" }} size={16}>
        <Alert
          type="info"
          showIcon
          title="任务、迭代记录、GitHub 链接与遗留问题将在对应功能交付后开放。"
        />
        {success && <Alert type="success" showIcon title="功能操作成功" />}
        {query.isPending ? (
          <Spin description="正在加载功能" />
        ) : query.isError ? (
          <Alert
            type="error"
            title={featureErrorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>重试</Button>}
          />
        ) : !query.data?.items.length ? (
          <Empty description="暂无功能" />
        ) : (
          query.data.items.map((item) => (
            <Card
              key={item.id}
              title={
                <Space wrap>
                  <span>{item.name}</span>
                  <Tag>{item.code}</Tag>
                  <Tag color={item.status === "ACTIVE" ? "green" : "default"}>
                    {item.status === "ACTIVE" ? "正常" : "已归档"}
                  </Tag>
                </Space>
              }
              extra={
                <Space>
                  {!featureId && (
                    <Button
                      href={`/projects/${projectId}/modules/${moduleId}/features/${item.id}`}
                    >
                      查看详情
                    </Button>
                  )}
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
              {featureId && (
                <p>
                  编号：{item.code} · 所属项目：{item.projectId} · 所属模块：
                  {item.moduleId} · 创建人：{item.createdBy}
                </p>
              )}
              <h2>当前功能说明</h2>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {item.currentBehavior || "暂无功能说明"}
              </p>
              <p>
                {item.tags.map((tag, index) => (
                  <Tag key={index}>{tag}</Tag>
                ))}
              </p>
              {item.status === "ARCHIVED" && (
                <p>归档历史仍可查看；恢复前不能在此功能新增下级内容。</p>
              )}
            </Card>
          ))
        )}
      </Space>
      <Modal
        open={selection !== null}
        title={
          selection?.action === "create"
            ? "新建功能"
            : selection?.action === "update"
              ? "编辑功能"
              : selection?.action === "archive"
                ? "归档功能"
                : "恢复功能"
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
                  ? "归档后功能及下级内容不可写，历史将保留。"
                  : "恢复功能本身的可写状态，不改变下级资源各自的归档状态。"}
              </p>
              <label htmlFor="feature-reason">操作原因</label>
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
                    id="feature-reason"
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
              <label htmlFor="feature-name">功能名称</label>
              <Controller
                name="name"
                control={control}
                rules={{
                  validate: (v) => v.trim().length > 0 || "请填写功能名称",
                  maxLength: { value: 500, message: "名称最多 500 字" },
                }}
                render={({ field }) => (
                  <Input
                    {...field}
                    id="feature-name"
                    disabled={mutation.isPending || reloading || !!merge}
                  />
                )}
              />
              <p role="alert">{errors.name?.message}</p>
              {selection?.action === "create" && (
                <SimilarFeatures
                  projectId={projectId}
                  moduleId={moduleId}
                  name={watch("name")}
                  client={client}
                />
              )}
              <label htmlFor="feature-currentBehavior">当前功能说明</label>
              <Controller
                name="currentBehavior"
                control={control}
                rules={{
                  maxLength: { value: 50000, message: "说明最多 50000 字" },
                }}
                render={({ field }) => (
                  <Input.TextArea
                    {...field}
                    id="feature-currentBehavior"
                    rows={5}
                    disabled={mutation.isPending || reloading || !!merge}
                  />
                )}
              />
              <p role="alert">{errors.currentBehavior?.message}</p>
              <label htmlFor="feature-tags">标签（每行一个，最多 50 个）</label>
              <Controller
                name="tags"
                control={control}
                rules={{
                  validate: (value) =>
                    value.split("\n").filter((tag) => tag.trim()).length <=
                      50 || "标签最多 50 个",
                }}
                render={({ field }) => (
                  <Input.TextArea
                    {...field}
                    id="feature-tags"
                    rows={2}
                    disabled={mutation.isPending || reloading || !!merge}
                  />
                )}
              />
              <p role="alert">{errors.tags?.message}</p>
            </>
          )}
          {mutation.isError && (
            <Alert type="error" title={featureErrorMessage(mutation.error)} />
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
                    <dd>{fieldValue(merge.base, field) || "（空）"}</dd>
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
