import React from "react";
import { Alert } from "antd";
import { useParams } from "react-router-dom";
import { useAuth } from "@features/auth/auth-context";
import { FeaturesPageView } from "@features/features/FeaturesPageView";
export default function FeaturesPage() {
  const params = useParams();
  const { user } = useAuth();
  const projectId = Number(params.projectId),
    moduleId = Number(params.moduleId),
    featureId = params.featureId ? Number(params.featureId) : undefined;
  if (
    ![
      projectId,
      moduleId,
      ...(featureId === undefined ? [] : [featureId]),
    ].every((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)
  )
    return <Alert type="error" title="功能地址无效" />;
  return (
    <FeaturesPageView
      key={Object.values(params).join("/")}
      projectId={projectId}
      moduleId={moduleId}
      featureId={featureId}
      isAdmin={user?.isAdmin === true}
    />
  );
}
