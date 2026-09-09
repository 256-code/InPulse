import React from "react";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { AdminUsersPageView } from "@features/users/AdminUsersPageView";

export interface SettingsPageProps {
  readonly client?: InpulseApiClient | undefined;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ client }) => {
  const { user } = useAuth();
  return (
    <AdminUsersPageView
      currentUserId={user?.id}
      {...(client ? { client } : {})}
    />
  );
};

export default SettingsPage;
