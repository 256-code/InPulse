import React, { useEffect, useState } from "react";
import { Button, Input, InputNumber, Space, Switch } from "antd";
import { Controller, useForm } from "react-hook-form";
import type { AiAssistSettings, InpulseApiClient } from "@generated/api";
import { CalmBadge, CalmSectionTitle } from "@features/common/components/Calm";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  aiAssistDisabledReasonText,
  aiAssistSettingsErrorMessage,
  aiAssistTestFailureText,
  useAiAssistSettings,
} from "./ai-assist-query";

export interface AiAssistSettingsPanelProps {
  readonly client?: InpulseApiClient | undefined;
}

interface FormValues {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxTokens: number;
  readonly apiKey: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 8192;

function sourceText(source: AiAssistSettings["source"]): string {
  if (source === "DATABASE") return "在线配置（数据库，优先于环境变量）";
  if (source === "ENVIRONMENT")
    return "环境变量（遗留模式；保存一次后即转为在线配置）";
  return "尚未配置";
}

/**
 * ADR-068 「成员与设置 → AI 辅助转换」面板：状态卡 + 表单 + 测试连接。
 * 密钥永不回显；留空表示保持已保存的密钥。权限判断全部在服务端完成。
 */
export const AiAssistSettingsPanel: React.FC<AiAssistSettingsPanelProps> = ({
  client,
}) => {
  const { query, save, test } = useAiAssistSettings(client);
  const [success, setSuccess] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    setError,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      enabled: false,
      endpoint: "",
      model: "",
      timeoutMs: DEFAULT_TIMEOUT_MS,
      maxTokens: DEFAULT_MAX_TOKENS,
      apiKey: "",
    },
  });

  const settings = query.data;
  useEffect(() => {
    if (settings === undefined) return;
    reset({
      enabled: settings.enabled,
      endpoint: settings.endpoint ?? "",
      model: settings.model ?? "",
      timeoutMs: settings.timeoutMs,
      maxTokens: settings.maxTokens,
      apiKey: "",
    });
  }, [settings, reset]);

  const submit = handleSubmit(async (values) => {
    setSuccess(null);
    save.reset();
    const apiKey = values.apiKey.trim();
    if (!(settings?.keyConfigured ?? false) && apiKey.length === 0) {
      setError("apiKey", { message: "首次配置必须提供 API 密钥" });
      return;
    }
    try {
      await save.mutateAsync({
        enabled: values.enabled,
        endpoint: values.endpoint.trim(),
        model: values.model.trim(),
        timeoutMs: values.timeoutMs,
        maxTokens: values.maxTokens,
        apiKey: apiKey.length === 0 ? null : apiKey,
      });
      setValue("apiKey", "");
      setSuccess("AI 辅助转换配置已保存");
    } catch {
      // 失败详情由 save 状态统一渲染。
    }
  });

  if (query.isPending) {
    return (
      <section className="panel settings-panel" aria-label="AI 辅助转换">
        <CalmSectionTitle
          title="AI 辅助转换"
          hint="成员在文档导入弹窗中用 AI 把自由文档转换为固定模板草稿"
        />
        <CalmSkeleton
          variant="list"
          rows={4}
          compact
          label="正在加载 AI 辅助转换配置"
        />
      </section>
    );
  }

  if (query.isError || settings === undefined) {
    return (
      <section className="panel settings-panel" aria-label="AI 辅助转换">
        <CalmSectionTitle
          title="AI 辅助转换"
          hint="成员在文档导入弹窗中用 AI 把自由文档转换为固定模板草稿"
        />
        <div className="permission-note" role="alert">
          <InpulseIcon name="alert" size={17} />
          <span>
            <strong>无法读取配置</strong>
            {aiAssistSettingsErrorMessage(query.error)}
          </span>
        </div>
        <Space>
          <Button size="small" onClick={() => void query.refetch()}>
            重试
          </Button>
        </Space>
      </section>
    );
  }

  const statusTone = settings.ready
    ? "green"
    : settings.disabledReason === "ENCRYPTION_KEY_UNAVAILABLE" ||
        settings.disabledReason === "CONFIG_INVALID"
      ? "red"
      : "amber";

  return (
    <section className="panel settings-panel" aria-label="AI 辅助转换">
      <CalmSectionTitle
        title="AI 辅助转换"
        hint="成员在文档导入弹窗中用 AI 把自由文档转换为固定模板草稿"
      />

      <div className="permission-note">
        <InpulseIcon name="zap" size={17} />
        <span>
          <strong>当前状态</strong>
          <CalmBadge tone={statusTone}>
            {settings.ready
              ? "已启用，可发起转换"
              : aiAssistDisabledReasonText(settings.disabledReason)}
          </CalmBadge>{" "}
          来源：{sourceText(settings.source)}
          {settings.keyConfigured
            ? "；密钥已配置（尾号 ****" + (settings.keyHint ?? "") + "）"
            : "；尚未配置密钥"}
          {settings.updatedAt !== null
            ? "；最近保存 " +
              new Date(settings.updatedAt).toLocaleString("zh-CN")
            : ""}
        </span>
      </div>

      {success ? (
        <div className="permission-note note-success" role="status">
          <InpulseIcon name="check" size={16} />
          <span>{success}</span>
        </div>
      ) : null}
      {save.isError ? (
        <div className="permission-note" role="alert">
          <InpulseIcon name="alert" size={16} />
          <span>{aiAssistSettingsErrorMessage(save.error)}</span>
        </div>
      ) : null}

      <form onSubmit={(event) => void submit(event)}>
        <div className="form-row">
          <label>启用 AI 辅助转换</label>
          <Controller
            name="enabled"
            control={control}
            render={({ field }) => (
              <Switch checked={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <div className="form-row">
          <label htmlFor="ai-assist-endpoint">服务端点</label>
          <Controller
            name="endpoint"
            control={control}
            rules={{ required: "请填写 AI 服务端点" }}
            render={({ field }) => (
              <Input
                id="ai-assist-endpoint"
                {...field}
                placeholder="https://api.example.com/v1/chat/completions"
              />
            )}
          />
        </div>
        {errors.endpoint ? (
          <small role="alert">{errors.endpoint.message}</small>
        ) : (
          <small className="form-hint">
            请填写完整的 chat/completions 地址（例如
            https://xxx/v1/chat/completions）；只填根地址 /v1
            会导致测试连接失败。
          </small>
        )}
        <div className="form-row">
          <label htmlFor="ai-assist-model">模型</label>
          <Controller
            name="model"
            control={control}
            rules={{ required: "请填写模型名称" }}
            render={({ field }) => (
              <Input
                id="ai-assist-model"
                {...field}
                placeholder="gpt-4o-mini"
              />
            )}
          />
        </div>
        {errors.model ? (
          <small role="alert">{errors.model.message}</small>
        ) : null}
        <div className="form-row">
          <label htmlFor="ai-assist-timeout">超时（毫秒）</label>
          <Controller
            name="timeoutMs"
            control={control}
            render={({ field }) => (
              <InputNumber
                id="ai-assist-timeout"
                min={1000}
                max={600000}
                step={1000}
                value={field.value}
                onChange={(value) =>
                  field.onChange(value ?? DEFAULT_TIMEOUT_MS)
                }
              />
            )}
          />
        </div>
        <div className="form-row">
          <label htmlFor="ai-assist-max-tokens">最大输出 tokens</label>
          <Controller
            name="maxTokens"
            control={control}
            render={({ field }) => (
              <InputNumber
                id="ai-assist-max-tokens"
                min={1}
                max={200000}
                value={field.value}
                onChange={(value) =>
                  field.onChange(value ?? DEFAULT_MAX_TOKENS)
                }
              />
            )}
          />
        </div>
        <div className="form-row">
          <label htmlFor="ai-assist-api-key">API 密钥</label>
          <Controller
            name="apiKey"
            control={control}
            render={({ field }) => (
              <Input.Password
                id="ai-assist-api-key"
                {...field}
                autoComplete="new-password"
                placeholder="留空表示保持已保存的密钥（不回显）"
              />
            )}
          />
        </div>
        {errors.apiKey ? (
          <small role="alert">{errors.apiKey.message}</small>
        ) : null}

        <Space>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            保存配置
          </Button>
          <Button
            onClick={() => {
              test.reset();
              void test.mutateAsync().catch(() => undefined);
            }}
            loading={test.isPending}
          >
            测试连接
          </Button>
        </Space>
      </form>

      {test.isSuccess ? (
        <div
          className={
            test.data.ok ? "permission-note note-success" : "permission-note"
          }
          role="status"
        >
          <InpulseIcon name={test.data.ok ? "check" : "alert"} size={16} />
          <span>
            {test.data.ok
              ? "连接成功，上游模型：" + (test.data.model ?? "")
              : "测试未通过：" +
                aiAssistTestFailureText(test.data.reason ?? "")}
          </span>
        </div>
      ) : null}
      {test.isError ? (
        <div className="permission-note" role="alert">
          <InpulseIcon name="alert" size={16} />
          <span>{aiAssistSettingsErrorMessage(test.error)}</span>
        </div>
      ) : null}
    </section>
  );
};

export default AiAssistSettingsPanel;
