import React, { useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import type { NotificationFilter } from "@features/notifications/notification-query";
import { NotificationsPageView } from "@features/notifications/NotificationsPageView";

export interface NotificationsPageProps {
  readonly client?: InpulseApiClient;
}

export const NotificationsPage: React.FC<NotificationsPageProps> = ({
  client,
}) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("filter") === "unread" ? "unread" : "all";

  const handleFilterChange = useCallback(
    (nextFilter: NotificationFilter) => {
      setSearchParams(nextFilter === "unread" ? { filter: "unread" } : {});
    },
    [setSearchParams],
  );

  const handleOpenTarget = useCallback(
    (targetPath: string) => {
      navigate(targetPath);
    },
    [navigate],
  );

  return (
    <NotificationsPageView
      filter={filter}
      onFilterChange={handleFilterChange}
      onOpenTarget={handleOpenTarget}
      {...(client ? { client } : {})}
    />
  );
};

export default NotificationsPage;
