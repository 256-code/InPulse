import React from "react";
import { Alert } from "antd";
import { useParams } from "react-router-dom";
import { useAuth } from "@features/auth/auth-context";
import { ModulesPageView } from "@features/modules/ModulesPageView";

export default function ModulesPage() {
  const { projectId } = useParams();
  const { user } = useAuth();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647)
    return <Alert type="error" title="项目地址无效" />;
  return (
    <ModulesPageView key={id} projectId={id} isAdmin={user?.isAdmin === true} />
  );
}
