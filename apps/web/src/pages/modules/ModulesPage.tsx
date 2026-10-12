import React from "react";
import { Alert } from "antd";
import { useParams } from "react-router-dom";
import { ModulesPageView } from "@features/modules/ModulesPageView";

export default function ModulesPage() {
  const { projectId } = useParams();
  const id = Number(projectId);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647)
    return <Alert type="error" title="项目地址无效" />;
  // 换项目仍落在同一条路由上，这里刻意不加 key（2026-10-10 项目间切换实测）：整页
  // 重建会让内容区先空一帧再淡入；页面改为原地换数据，见 module-query 的 keepPreviousData。
  return <ModulesPageView projectId={id} />;
}
