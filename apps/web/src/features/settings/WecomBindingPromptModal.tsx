import React from "react";
import { Button } from "antd";

import { AppModal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import type { InpulseApiClient } from "@generated/api";

import { useWecomBinding } from "./wecom-binding-query";
import { useWecomBindingPromptDismissal } from "./wecom-binding-prompt";

export interface WecomBindingPromptModalProps {
  /** 已登录且不在退出流程中才可能弹；未登录时完全不请求绑定状态。 */
  readonly enabled: boolean;
  readonly userId: number | null;
  readonly client?: InpulseApiClient | undefined;
  /** 「去绑定」：打开账户菜单里的绑定弹窗（WecomBindingModal）。 */
  readonly onGoBind: () => void;
}

/**
 * ADR-079 「未绑定企业微信」主动提醒弹窗：已登录、管理员已配置机器人且个人
 * 状态为 UNBOUND 时弹出，引导用户去绑定。三个动作——去绑定（打开账户菜单里
 * 的绑定弹窗）、忽略（本次浏览器会话不再弹）、不再提醒（按账号持久不再弹）。
 *
 * 只有「本轮取回」的状态才参与判断（`isFetching` 期间不弹）：同一标签页内
 * 切换账号时缓存里可能还是上一个账号的旧状态；PENDING / BOUND、机器人未
 * 配置或读取失败时一律静默不弹，不打扰用户。
 *
 * 头部留白与分隔线沿用账户菜单绑定弹层的口径（`.wecom-binding-modal > .drawer-header`）：
 * 不挂该头部类时头部没有内边距，图标片会顶到盒子上沿被圆角裁切、标题列与正文错位。
 */
export const WecomBindingPromptModal: React.FC<
  WecomBindingPromptModalProps
> = ({ enabled, userId, client, onGoBind }) => {
  const dismissal = useWecomBindingPromptDismissal(userId);
  const askable = enabled && userId !== null && dismissal.shouldAsk;
  const { query } = useWecomBinding(client, { enabled: askable });
  const status = query.data;
  const open =
    askable &&
    query.isSuccess &&
    !query.isFetching &&
    status !== undefined &&
    status.robotConfigured &&
    status.state === "UNBOUND";

  const handleGoBind = (): void => {
    dismissal.dismissForSession();
    onGoBind();
  };

  return (
    <AppModal
      open={open}
      size="md"
      className="wecom-binding-modal"
      tone="info"
      icon="bell"
      eyebrow="企业微信提醒"
      title="绑定企业微信，及时收到任务提醒"
      closeLabel="关闭绑定提醒"
      onCancel={dismissal.dismissForSession}
      body
      footer={
        <>
          <Button onClick={dismissal.dismissForSession}>忽略</Button>
          <Button onClick={dismissal.dismissForever}>不再提醒</Button>
          <Button type="primary" onClick={handleGoBind}>
            去绑定
          </Button>
        </>
      }
    >
      <div className="wecom-binding-note">
        <InpulseIcon name="bell" size={17} />
        <span>
          <strong>你还没有绑定企业微信</strong>
          任务被指派给你时，企业微信机器人会在手机上提醒你；未绑定将收不到这些提醒。
        </span>
      </div>
      <ol className="wecom-binding-steps">
        <li>点右下角「去绑定」，生成一次性绑定码；</li>
        <li>在企业微信里打开 InPulse 机器人；</li>
        <li>把绑定码发送给机器人，即可完成绑定。</li>
      </ol>
      <p className="wecom-binding-meta">
        「忽略」仅本次会话暂停；「不再提醒」将永久关闭提醒，之后仍可在账户菜单里绑定。
      </p>
    </AppModal>
  );
};
