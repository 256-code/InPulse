import type { ProjectItem, ProjectListItem } from "@inpulse/api-contract";

/** 项目只读查询 Port；调用方先通过 AuthorizedProjectScope 限制项目范围。 */
export abstract class ProjectQueryPort {
  /**
   * 项目列表；提供 actorUserId 时附带该用户在本项目的成员角色与待审归档
   * 申请摘要（ADR-034），供列表页决定「申请归档」与审核入口。
   */
  abstract list(
    projectIds: readonly number[],
    actorUserId?: number,
  ): Promise<readonly ProjectListItem[]>;

  abstract find(projectId: number): Promise<ProjectItem | undefined>;

  /** ADR-033：当前用户在本项目的 ACTIVE 成员角色；非成员返回 null。 */
  abstract findActiveMemberRole(
    projectId: number,
    userId: number,
  ): Promise<"MEMBER" | "LEADER" | null>;
}
