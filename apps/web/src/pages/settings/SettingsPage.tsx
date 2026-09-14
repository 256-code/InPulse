import React from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { AdminUsersPageView } from "@features/users/AdminUsersPageView";

export interface SettingsPageProps {
  readonly client?: InpulseApiClient | undefined;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ client }) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  return (
    <AdminUsersPageView
      currentUserId={user?.id}
      onOpenProjects={() => navigate("/projects")}
      {...(client ? { client } : {})}
    />
  );
};

export default SettingsPage;
