import React, { useEffect, useState } from "react";
import { formatBeijingSecond } from "@features/common/beijing-time";
import { Alert, Button, Popconfirm } from "antd";

import { AppModal } from "@features/common/components/AppModal";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import type { InpulseApiClient } from "@generated/api";

import {
  useWecomBinding,
  wecomBindingErrorMessage,
} from "./wecom-binding-query";

export interface WecomBindingModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly client?: InpulseApiClient | undefined;
}

function formatTimestamp(value: string): string {
  return formatBeijingSecond(value);
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
}

/**
 * ADR-069 「账户菜单 → 绑定企业微信」弹层：读取三态绑定状态（UNBOUND /
 * PENDING / BOUND）、签发一次性绑定码（明文只展示一次、10 分钟有效）、
 * 解除绑定（REVOKED 状态流转，不物理删除）。有待用码时每 5 秒轮询一次，
 * 用户把码发给企微机器人后自动显示「已绑定」。
 *
 * 布局约定：头部由 .wecom-binding-modal > .drawer-header 提供内边距与分隔线，
 * 正文统一走 AppModal 的 body（.modal-body，带内边距与滚动），内容按
 * 「状态说明 → 步骤 / 绑定码卡片」两段组织，未生成时用虚线占位保持高度稳定。
 */
export const WecomBindingModal: React.FC<WecomBindingModalProps> = ({
  open,
  onClose,
  client,
}) => {
  const { query, issueCode, unbind } = useWecomBinding(client, {
    enabled: open,
  });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [robotCopyState, setRobotCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [now, setNow] = useState(() => Date.now());

  // 绑定码有效期倒计时：只在弹层打开时走秒。
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  // 关闭后清掉上一次打开的瞬时状态与错误，重开时回到干净状态。
  // 依赖只能取 mutation 的 reset 函数（observer 上的稳定引用）；直接依赖
  // useMutation 的返回对象会以新引用触发每轮渲染后的重复执行。
  const resetIssueCode = issueCode.reset;
  const resetUnbind = unbind.reset;
  useEffect(() => {
    if (open) return;
    setCopyState("idle");
    setRobotCopyState("idle");
    resetIssueCode();
    resetUnbind();
  }, [open, resetIssueCode, resetUnbind]);

  const status = query.data;
  const robotUrl = status?.botProfileUrl ?? null;
  const code = issueCode.data?.code ?? null;
  const codeExpiresAt =
    issueCode.data?.expiresAt ?? status?.codeExpiresAt ?? null;
  const remainingMs =
    codeExpiresAt === null ? 0 : Date.parse(codeExpiresAt) - now;
  const codeUsable = code !== null && remainingMs > 0;
  const bound = status?.state === "BOUND";
  const pendingWithoutCode =
    !codeUsable && status?.state === "PENDING" && codeExpiresAt !== null;

  const hasExistingCode = code !== null || pendingWithoutCode;

  async function handleCopy(): Promise<void> {
    if (code === null) return;
    if (navigator.clipboard === undefined) {
      setCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(code);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function handleCopyRobotUrl(): Promise<void> {
    if (robotUrl === null) return;
    if (navigator.clipboard === undefined) {
      setRobotCopyState("failed");
      return;
    }
    try {
      await navigator.clipboard.writeText(robotUrl);
      setRobotCopyState("copied");
    } catch {
      setRobotCopyState("failed");
    }
  }

  const generate = (): void => {
    setCopyState("idle");
    issueCode.mutate();
  };

  const robotLinkNote =
    robotUrl === null ? null : (
      <div className="wecom-binding-robot-link">
        <div className="wecom-binding-robot-link-head">
          <InpulseIcon name="externalLink" size={15} />
          <span>先在「企业微信」中打开机器人</span>
        </div>
        <code aria-label="机器人链接">{robotUrl}</code>
        <div className="wecom-binding-code-actions">
          <Button size="small" onClick={() => void handleCopyRobotUrl()}>
            复制机器人链接
          </Button>
          {robotCopyState === "copied" ? (
            <span role="status">已复制；发到企业微信任意会话中点击打开</span>
          ) : robotCopyState === "failed" ? (
            <span role="alert">复制失败，请手动选中链接复制</span>
          ) : (
            <span>可先发到企业微信任意会话，再点击打开</span>
          )}
        </div>
      </div>
    );

  return (
    <AppModal
      open={open}
      size="md"
      className="wecom-binding-modal"
      eyebrow="账户设置"
      title="绑定企业微信"
      closeLabel="关闭绑定企业微信"
      onCancel={onClose}
      body
      footer={
        <>
          <Button onClick={onClose}>关闭</Button>
          {bound ? (
            <Popconfirm
              title="解除企业微信绑定？"
              description="解除后，指派给你的任务不会再通过企业微信机器人提醒；你可以随时重新绑定。"
              okText="解除绑定"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => unbind.mutate()}
            >
              <Button danger loading={unbind.isPending}>
                解除绑定
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="primary"
              loading={issueCode.isPending}
              disabled={query.isPending || query.isError}
              onClick={generate}
            >
              {hasExistingCode ? "重新生成绑定码" : "生成绑定码"}
            </Button>
          )}
        </>
      }
    >
      {query.isPending ? (
        <CalmSkeleton
          variant="lines"
          rows={4}
          label="正在读取企业微信绑定状态"
        />
      ) : query.isError || status === undefined ? (
        <div className="wecom-binding-note is-alert" role="alert">
          <InpulseIcon name="alert" size={17} />
          <span>
            <strong>无法读取绑定状态</strong>
            {wecomBindingErrorMessage(query.error)}
          </span>
        </div>
      ) : bound ? (
        <>
          <div className="wecom-binding-note is-ready" role="status">
            <InpulseIcon name="check" size={17} />
            <span>
              <strong>已绑定企业微信</strong>
              指派给你的任务会由企业微信机器人提醒你。
            </span>
          </div>
          <p className="wecom-binding-meta">
            绑定时间：
            {status.boundAt === null ? "未知" : formatTimestamp(status.boundAt)}
          </p>
          {unbind.isError ? (
            <div className="wecom-binding-alert">
              <Alert
                type="error"
                showIcon
                message={wecomBindingErrorMessage(unbind.error)}
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          {unbind.isSuccess ? (
            <div className="wecom-binding-alert">
              <Alert type="success" showIcon message="已解除绑定。" />
            </div>
          ) : null}
          {codeUsable ? (
            <>
              <div className="wecom-binding-note" role="status">
                <InpulseIcon name="clock" size={17} />
                <span>
                  <strong>绑定码已生成</strong>
                  把它发送给企业微信里的 InPulse
                  机器人；发送后本弹窗会自动刷新为「已绑定」。
                </span>
              </div>
              <div className="wecom-binding-code">
                <code aria-label="企业微信绑定码">{code}</code>
                <div className="wecom-binding-code-foot">
                  <small>剩余有效时间：{formatRemaining(remainingMs)}</small>
                  <div className="wecom-binding-code-actions">
                    <Button size="small" onClick={() => void handleCopy()}>
                      复制绑定码
                    </Button>
                    {copyState === "copied" ? (
                      <span role="status">已复制，去企业微信发给机器人</span>
                    ) : copyState === "failed" ? (
                      <span role="alert">复制失败，请手动选中绑定码复制</span>
                    ) : null}
                  </div>
                </div>
              </div>
              {robotLinkNote}
            </>
          ) : pendingWithoutCode ? (
            <>
              <div className="wecom-binding-note" role="status">
                <InpulseIcon name="clock" size={17} />
                <span>
                  <strong>已有一个待用绑定码</strong>
                  有效期至 {formatTimestamp(codeExpiresAt)}
                  ；如果它已经丢失，请点右下角「重新生成绑定码」。
                </span>
              </div>
              {robotLinkNote}
            </>
          ) : (
            <>
              <div className="wecom-binding-note">
                <InpulseIcon name="bell" size={17} />
                <span>
                  <strong>绑定后即可在手机上收到提醒</strong>
                  指派给你的任务会由企业微信机器人提醒你。
                </span>
              </div>
              {robotLinkNote}
              <ol className="wecom-binding-steps">
                <li>
                  {robotUrl !== null
                    ? "用上面的链接在企业微信中打开机器人；"
                    : "在企业微信中找到 InPulse 机器人；"}
                </li>
                <li>点右下角「生成绑定码」；</li>
                <li>把绑定码发送给机器人；</li>
                <li>弹窗自动刷新，显示「已绑定」后即完成。</li>
              </ol>
              <div className="wecom-binding-placeholder">
                生成后，绑定码会显示在这里（10 分钟内有效、只能使用一次）
              </div>
            </>
          )}
          {code !== null && !codeUsable ? (
            <div className="wecom-binding-alert">
              <Alert
                type="warning"
                showIcon
                message="绑定码已过期，请点击「重新生成绑定码」。"
              />
            </div>
          ) : null}
          {issueCode.isError ? (
            <div className="wecom-binding-alert">
              <Alert
                type="error"
                showIcon
                message={wecomBindingErrorMessage(issueCode.error)}
              />
            </div>
          ) : null}
        </>
      )}
    </AppModal>
  );
};
