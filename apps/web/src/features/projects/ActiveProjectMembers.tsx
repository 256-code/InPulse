import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Spin } from "antd";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { useProjectDetail } from "./project-query";
import { projectMemberErrorMessage } from "./project-member-query";
export function ActiveProjectMembers({
  projectId,
  client,
}: {
  projectId: number;
  client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const project = useProjectDetail({ projectId, client });
  const members = useQuery({
    queryKey: ["active-project-members", projectId],
    queryFn: ({ signal }) =>
      api.listActiveProjectMembers(projectId, { signal }),
    retry: false,
  });
  return (
    <section className="project-members">
      <a href={"/projects/" + projectId + "/overview"}>返回项目概览</a>
      <h1>{project.data?.name ?? "项目"} · 项目成员</h1>
      <p>当前项目成员；成员增删由管理员处理。</p>
      {members.isPending ? (
        <Spin />
      ) : members.isError ? (
        <Alert
          type="error"
          title={projectMemberErrorMessage(members.error)}
          action={<Button onClick={() => void members.refetch()}>重试</Button>}
        />
      ) : (
        <ul>
          {members.data.items.map((member) => (
            <li key={member.id}>{member.name}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
