import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Space, Spin } from "antd";
import { useQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";

export function SimilarFeatures({
  projectId,
  moduleId,
  name,
  client,
}: {
  projectId: number;
  moduleId: number;
  name: string;
  client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [settled, setSettled] = useState("");
  const text = name.trim();
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(text), 350);
    return () => window.clearTimeout(timer);
  }, [text]);
  const enabled = settled === text && text.length >= 2 && text.length <= 200;
  const query = useQuery({
    queryKey: ["feature-similar", projectId, moduleId, settled],
    queryFn: ({ signal }) =>
      api.findSimilarFeatures(projectId, moduleId, { q: settled }, { signal }),
    enabled,
    retry: false,
  });
  if (!enabled)
    return <p>输入 2–200 字名称后提示当前项目的关键词候选；仍可继续创建。</p>;
  if (query.isPending) return <Spin description="正在查询相似候选" />;
  if (query.isError)
    return (
      <Alert
        type="warning"
        title="候选查询失败，不影响继续创建"
        action={<Button onClick={() => void query.refetch()}>重试提示</Button>}
      />
    );
  return (
    <section aria-label="相似功能提示">
      <p>
        {query.data.items.length
          ? "可能已存在相似功能，可查看或继续填写并保存："
          : "当前项目未找到关键词候选，可以继续创建。"}
      </p>
      <Space orientation="vertical">
        {query.data.items.map((item) => (
          <Button
            key={item.id}
            type="link"
            href={`/projects/${item.projectId}/modules/${item.moduleId}/features/${item.id}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.code} {item.name}（
            {item.status === "ACTIVE" ? "正常" : "已归档"}）
          </Button>
        ))}
      </Space>
    </section>
  );
}
