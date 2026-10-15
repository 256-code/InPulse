import React from "react";

/**
 * ADR-079 「未绑定企业微信」提醒弹窗的本地忽略状态：只存浏览器本地，不入库、
 * 不进契约、不写审计，与绑定本身（`/me/wecom-binding`）相互独立。
 *
 * - 忽略（dismissForSession）：sessionStorage 按账号记录，本次浏览器会话
 *   （含刷新）不再弹出，关闭标签页后恢复提醒；
 * - 不再提醒（dismissForever）：localStorage 按账号记录，跨刷新与重启浏览器
 *   持续生效；此后仍可从账户菜单手动绑定。
 *
 * 存储内容是已忽略 / 已关闭提醒的用户 ID 数组；损坏或存储不可用时按「无记录」
 * 处理（最多多弹一次提醒，不影响页面渲染）。
 */
export const WECOM_BINDING_PROMPT_SESSION_KEY =
  "inpulse.wecom-binding.prompt-ignored";
export const WECOM_BINDING_PROMPT_STORAGE_KEY =
  "inpulse.wecom-binding.prompt-dismissed";

interface PromptUserIdsStore {
  readonly read: () => readonly number[];
  readonly write: (ids: readonly number[]) => void;
}

/**
 * 存储读写统一 try/catch：隐私模式等场景下访问 storage 可能抛错，
 * 读失败按空列表、写失败静默（本次会话内状态仍然生效）。
 */
function createUserIdStore(
  key: string,
  resolveStorage: () => Storage,
): PromptUserIdsStore {
  return {
    read: (): readonly number[] => {
      try {
        const raw = resolveStorage().getItem(key);
        if (raw === null) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
          (value): value is number =>
            typeof value === "number" && Number.isInteger(value) && value > 0,
        );
      } catch {
        return [];
      }
    },
    write: (ids: readonly number[]): void => {
      try {
        resolveStorage().setItem(key, JSON.stringify(ids));
      } catch {
        // 写入失败：本次会话内仍然生效，只是刷新 / 重开后不再保留。
      }
    },
  };
}

const sessionIgnoredStore = createUserIdStore(
  WECOM_BINDING_PROMPT_SESSION_KEY,
  () => globalThis.sessionStorage,
);
const persistentDismissedStore = createUserIdStore(
  WECOM_BINDING_PROMPT_STORAGE_KEY,
  () => globalThis.localStorage,
);

export interface WecomBindingPromptDismissal {
  /** 当前账号是否还需要弹提醒（未忽略且未关闭过）。 */
  readonly shouldAsk: boolean;
  /** 忽略：本浏览器会话不再弹。 */
  readonly dismissForSession: () => void;
  /** 不再提醒：按账号持久不再弹。 */
  readonly dismissForever: () => void;
}

export function useWecomBindingPromptDismissal(
  userId: number | null,
): WecomBindingPromptDismissal {
  const [ignoredIds, setIgnoredIds] = React.useState<readonly number[]>(() =>
    sessionIgnoredStore.read(),
  );
  const [dismissedIds, setDismissedIds] = React.useState<readonly number[]>(
    () => persistentDismissedStore.read(),
  );

  const shouldAsk =
    userId !== null &&
    !ignoredIds.includes(userId) &&
    !dismissedIds.includes(userId);

  const dismissForSession = React.useCallback((): void => {
    if (userId === null) return;
    setIgnoredIds((current) => {
      if (current.includes(userId)) return current;
      const next = [...current, userId];
      sessionIgnoredStore.write(next);
      return next;
    });
  }, [userId]);

  const dismissForever = React.useCallback((): void => {
    if (userId === null) return;
    setDismissedIds((current) => {
      if (current.includes(userId)) return current;
      const next = [...current, userId];
      persistentDismissedStore.write(next);
      return next;
    });
  }, [userId]);

  return { shouldAsk, dismissForSession, dismissForever };
}
