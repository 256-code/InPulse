import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createApiClient, type InpulseApiClient } from "@generated/api";
import { ExternalLinksPanel } from "./ExternalLinksPanel";
import { repositoryDisplayPath } from "./repository-path";
import { InpulseIcon } from "@features/common/components/InpulseIcon";

export { repositoryDisplayPath } from "./repository-path";

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
  /** 只读入口：有根仓库时直接跳转；没有时不渲染，由右侧管理按钮的待配置样式承担提示。 */
  const jumpButton = repository ? (
    <a
      className="repo-jump-button"
      href={repository.normalizedUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={"项目根仓库：" + repository.normalizedUrl}
    >
      项目根仓库
      <span className="repo-jump-path">
        {repositoryDisplayPath(repository.normalizedUrl)}
      </span>
      <InpulseIcon name="externalLink" size={13} />
    </a>
  ) : null;
  return (
    <span className="project-repository-link">
      {jumpButton}
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
        triggerUnconfiguredHint={
          links.isSuccess && !repository ? "尚未配置项目根仓库" : undefined
        }
      />
    </span>
  );
}
