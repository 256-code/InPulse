import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient, NotificationPage } from "@generated/api";
import {
  useNotificationActions,
  useNotificationsInfiniteQuery,
} from "./notification-query";

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { readonly children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("notification query hooks", () => {
  it("loads notification pages with the unread filter and cursor", async () => {
    const getNotifications = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: "1",
            projectId: 1,
            notificationType: "PROJECT_JOINED",
            title: "加入项目",
            body: "欢迎加入项目",
            targetPath: "/projects/1/activity",
            createdAt: "2026-09-08T00:00:00.000Z",
            readAt: null,
          },
        ],
        nextCursor: "cursor-1",
        hasMore: true,
      } satisfies NotificationPage)
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      } satisfies NotificationPage);
    const client = { getNotifications } as unknown as InpulseApiClient;
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useNotificationsInfiniteQuery({ client, filter: "unread" }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getNotifications).toHaveBeenCalledWith(
      { cursor: undefined, unreadOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(getNotifications).toHaveBeenLastCalledWith(
      { cursor: "cursor-1", unreadOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("issues CSRF and sends an idempotency key for a notification write", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const readNotification = vi.fn().mockResolvedValue(undefined);
    const client = {
      issueCsrfToken,
      readNotification,
    } as unknown as InpulseApiClient;
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useNotificationActions({ client }), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync({
        kind: "read",
        notificationId: 42,
      });
    });

    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(readNotification).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
  });
});
