import React, { useEffect, useRef, useState } from "react";
import type { InpulseApiClient, NotificationItem } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeNotificationError,
  useNotificationActions,
  useNotificationsInfiniteQuery,
  useNotificationUnreadCount,
} from "./notification-query";

export interface NotificationBellProps {
  readonly client?: InpulseApiClient | undefined;
  readonly enabled?: boolean;
  readonly onOpen: () => void;
  readonly onOpenTarget?: (targetPath: string) => void;
}

function parseNotificationId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const now = Date.now();
  const diffMs = now - parsed.getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} 小时前`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays} 天前`;
  }
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  client,
  enabled = true,
  onOpen,
  onOpenTarget,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const unreadQuery = useNotificationUnreadCount({ client, enabled });
  const listQuery = useNotificationsInfiniteQuery({
    client,
    enabled: enabled && open,
    filter: "all",
    limit: 5,
  });
  const actions = useNotificationActions({ client });
  const unreadCount = unreadQuery.data ?? 0;
  const items = listQuery.data?.pages.flatMap((page) => [...page.items]) ?? [];

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleOpenItem = (item: NotificationItem) => {
    const notificationId = parseNotificationId(item.id);
    if (item.readAt === null && notificationId !== null) {
      void actions.mutate({ kind: "read", notificationId });
    }
    setOpen(false);
    if (item.targetPath !== null) {
      onOpenTarget?.(item.targetPath);
      return;
    }
    onOpen();
  };

  const handleReadAll = () => {
    void actions.mutate({ kind: "readAll" });
  };

  let content: React.ReactNode;
  if (listQuery.isPending) {
    content = <div className="notification-state">正在加载通知...</div>;
  } else if (listQuery.isError) {
    content = (
      <div className="notification-state notification-state-error">
        {describeNotificationError(listQuery.error)}
      </div>
    );
  } else if (items.length === 0) {
    content = <div className="notification-state">暂无通知</div>;
  } else {
    content = (
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className={item.readAt === null ? "" : "read"}
            data-testid={`notification-popover-item-${item.id}`}
          >
            <button
              type="button"
              aria-label={`打开通知：${item.title}`}
              onClick={() => handleOpenItem(item)}
            >
              <span>{item.title}</span>
              <small>
                {formatNotificationTime(item.createdAt)} · {item.body}
              </small>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="popover-wrap" ref={rootRef}>
      <button
        type="button"
        className="icon-button notification-trigger"
        aria-label="通知"
        aria-expanded={open}
        title={`${unreadCount} 条未读通知`}
        onClick={() => setOpen((current) => !current)}
      >
        <InpulseIcon name="bell" size={18} />
        {unreadCount > 0 ? <i className="bell-dot" /> : null}
      </button>
      {open ? (
        <div
          className="popover notification-popover"
          role="dialog"
          aria-label="通知中心"
        >
          <div className="popover-head">
            <strong>通知中心</strong>
            <button
              type="button"
              className="text-button"
              disabled={unreadCount === 0 || actions.isPending}
              onClick={handleReadAll}
            >
              <InpulseIcon name="check" size={13} />
              全部已读
            </button>
          </div>
          <p className="popover-hint">只通知需要采取行动或关注结果的人。</p>
          {content}
          <button
            type="button"
            className="notification-footer"
            onClick={onOpen}
          >
            查看全部通知
            <InpulseIcon name="chevron" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
};
