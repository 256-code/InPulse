import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { ExternalLinksPanel } from "./ExternalLinksPanel";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
export function ProjectRepositoryLink({
  projectId,
  client,
}: {
  projectId: number;
  client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const links = useQuery({
    queryKey: ["project-repository", projectId],
    queryFn: ({ signal }) =>
      api.listExternalLinks("PROJECT", projectId, { signal }),
    retry: false,
  });
  const repository = links.data?.items.find((item) => item.isRootRepository);
  return (
    <span className="project-repository-link">
      {repository && (
        <a
          href={repository.normalizedUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <InpulseIcon name="code" size={16} /> 项目根仓库{" "}
          <InpulseIcon name="externalLink" size={14} />
        </a>
      )}
      {links.isSuccess && !repository && (
        <span role="status">尚未配置项目根仓库</span>
      )}
      {links.isError && (
        <span role="status">
          仓库链接加载失败{" "}
          <button type="button" onClick={() => void links.refetch()}>
            重新加载仓库
          </button>
        </span>
      )}
      <ExternalLinksPanel
        targetType="PROJECT"
        targetId={projectId}
        client={api}
      />
    </span>
  );
}
