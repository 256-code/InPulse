import type { ProjectItem } from "@inpulse/api-contract";

/** 项目只读查询 Port；调用方先通过 AuthorizedProjectScope 限制项目范围。 */
export abstract class ProjectQueryPort {
  abstract list(projectIds: readonly number[]): Promise<readonly ProjectItem[]>;

  abstract find(projectId: number): Promise<ProjectItem | undefined>;
}
