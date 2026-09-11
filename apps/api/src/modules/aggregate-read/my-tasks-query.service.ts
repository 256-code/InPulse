import { Inject, Injectable } from "@nestjs/common";

import {
  AGGREGATE_READ_PAGE_LIMIT_DEFAULT,
  type MyTaskItem,
  type MyTaskPage,
} from "@inpulse/api-contract";

import { UserReadPort, type UserRefItem } from "../../auth/user-read.port.js";
import {
  PostgresUnitOfWork,
  type UnitOfWork,
} from "../../database/unit-of-work.js";
import {
  ChangeRecordReadPort,
  MyTaskQueryPort,
  type MyTaskPriority,
} from "../change-records/index.js";
import { ExternalLinksQueryPort } from "../external-links/index.js";
import { FeatureReadPort } from "../features/index.js";
import { ModuleReadPort } from "../modules/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  ProjectQueryPort,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { TaskGroupMembershipReadPort } from "../task-groups/index.js";
import {
  AggregateReadCursorError,
  AggregateReadCursorService,
} from "./aggregate-read-cursor.js";
import {
  AggregateReadError,
  invalidCursorError,
} from "./aggregate-read.errors.js";

/**
 * R-3 我的任务聚合读（F-32）。
 *
 * 负责人固定为当前用户（A 裁决 Q-08），不接受任何他人身份或授权范围参数；
 * projectId 只用于缩小范围，最终仍按服务端 AuthorizedProjectScope 过滤，
 * 越权项目直接收敛为空页而不是 404（不泄露其他项目是否存在）。
 * 排序固定 ORDER BY t.id DESC（Q-10），游标签名绑定 actor 与六项筛选。
 * 记录维度：hasPublishedRecord 由任务 → PUBLISHED 记录数映射派生（count > 0，裁决
 * 修订 D-1），筛选仍由 MyTaskQueryPort.list 在同一分页 SQL 内先过滤后分页。
 * 统计卡片与遗留问题入口按 A 裁决 §10.3：基准集合只受负责人与 projectId 影响，
 * 分页与游标不影响计数，日界/月界由 SQL 按 Asia/Shanghai 计算。
 *
 * effectiveOnly 不在此处使用：R-3 需要返回 CANCELED / INVALID 任务才能让
 * workStatus 筛选有意义；§29.1 的「有效任务」口径只服务 R-2 的未完成任务计数。
 * 历史来源分支（task_group_members 的 HISTORICAL 来源）仍按 Q-04 排除。
 */
export interface MyTasksQueryCommand {
  readonly actorUserId: number;
  readonly cursor?: string;
  readonly limit?: number;
  readonly projectId?: number;
  readonly scopeType?: "FEATURE" | "MODULE";
  readonly workStatus?: "TODO" | "DONE" | "CANCELED";
  readonly hasPublishedRecord?: boolean;
  readonly priority?: MyTaskPriority;
  /**
   * 与 workStatus 组合表达「未完成并含已取消」（TODO ∪ CANCELED）：
   * workStatus 缺省时全集本就包含 CANCELED，该参数不产生额外过滤（A 裁决 §10.3）。
   */
  readonly includeCanceled?: boolean;
}

function inconsistentError(detail: string): AggregateReadError {
  return new AggregateReadError(
    500,
    "AGGREGATE_READ_INCONSISTENT",
    "聚合读数据不完整，无法完成查询：" + detail,
  );
}

function toUserRef(user: UserRefItem): {
  readonly userId: number;
  readonly name: string;
  readonly avatarUrl: string | null;
} {
  return { userId: user.userId, name: user.name, avatarUrl: user.avatarUrl };
}

/**
 * R-3 的 workStatus 与 includeCanceled 组合（A 裁决 §10.3）：
 * workStatus 缺省表示全集（本已包含 CANCELED）；includeCanceled = true 时
 * 在显式 workStatus 上并入 CANCELED（TODO ∪ CANCELED），否则保持单值。
 */
function effectiveWorkStatuses(
  command: MyTasksQueryCommand,
): readonly ("TODO" | "DONE" | "CANCELED")[] | undefined {
  if (command.workStatus === undefined) {
    return undefined;
  }
  if (command.includeCanceled === true && command.workStatus !== "CANCELED") {
    return [command.workStatus, "CANCELED"];
  }
  return [command.workStatus];
}

@Injectable()
export class MyTasksQueryService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly projectAccess: ProjectAccessQueryPort,
    @Inject(ProjectQueryPort) private readonly projects: ProjectQueryPort,
    @Inject(MyTaskQueryPort) private readonly myTasks: MyTaskQueryPort,
    @Inject(ModuleReadPort) private readonly modules: ModuleReadPort,
    @Inject(FeatureReadPort) private readonly features: FeatureReadPort,
    @Inject(ChangeRecordReadPort)
    private readonly records: ChangeRecordReadPort,
    @Inject(ExternalLinksQueryPort)
    private readonly links: ExternalLinksQueryPort,
    @Inject(TaskGroupMembershipReadPort)
    private readonly membership: TaskGroupMembershipReadPort,
    @Inject(UserReadPort) private readonly users: UserReadPort,
    @Inject(PostgresUnitOfWork) private readonly unitOfWork: UnitOfWork,
    private readonly cursor: AggregateReadCursorService,
  ) {}

  async list(command: MyTasksQueryCommand): Promise<MyTaskPage> {
    const scope = await this.projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    const limit = command.limit ?? AGGREGATE_READ_PAGE_LIMIT_DEFAULT;
    const projectIds =
      command.projectId === undefined
        ? scope.projectIds
        : scope.projectIds.filter(
            (projectId) => projectId === command.projectId,
          );
    const filterKey = JSON.stringify([
      command.projectId ?? null,
      command.scopeType ?? null,
      command.workStatus ?? null,
      command.hasPublishedRecord ?? null,
      command.priority ?? null,
      command.includeCanceled ?? null,
    ]);
    const afterTaskId = this.decodeCursor(
      command.cursor,
      command.actorUserId,
      filterKey,
    );
    const workStatuses = effectiveWorkStatuses(command);

    const data = await this.unitOfWork.run(async (tx) => {
      const excludedTaskIds = await this.membership.listHistoricalSourceTaskIds(
        tx,
        projectIds,
      );
      const page = await this.myTasks.list(tx, {
        projectIds,
        assigneeId: command.actorUserId,
        limit,
        excludedTaskIds,
        ...(workStatuses === undefined ? {} : { workStatuses }),
        ...(command.scopeType === undefined
          ? {}
          : { scopeTypes: [command.scopeType] }),
        ...(command.hasPublishedRecord === undefined
          ? {}
          : { hasPublishedRecord: command.hasPublishedRecord }),
        ...(command.priority === undefined
          ? {}
          : { priority: command.priority }),
        ...(afterTaskId === null ? {} : { afterTaskId }),
      });
      const taskIds = page.items.map((item) => item.taskId);
      const pageProjectIds = [
        ...new Set(page.items.map((item) => item.projectId)),
      ];
      const moduleIds = [...new Set(page.items.map((item) => item.moduleId))];
      const featureIds = [
        ...new Set(
          page.items
            .map((item) => item.featureId)
            .filter((featureId): featureId is number => featureId !== null),
        ),
      ];
      const modules = await this.modules.listNames(tx, {
        projectIds: pageProjectIds,
        moduleIds,
      });
      const features = await this.features.listNames(tx, {
        projectIds: pageProjectIds,
        featureIds,
      });
      const assignees = await this.users.listByIds(tx, [
        ...new Set(page.items.map((item) => item.assigneeId)),
      ]);
      const publishedRecordCounts = await this.records.countPublishedByTask(
        tx,
        pageProjectIds,
        taskIds,
      );
      const groupRoles = await this.membership.listGroupRoles(
        tx,
        pageProjectIds,
        taskIds,
      );
      const linkCounts = await this.links.countTaskLinks(
        tx,
        pageProjectIds,
        taskIds,
      );
      const stats = await this.myTasks.stats(tx, {
        projectIds,
        assigneeId: command.actorUserId,
        excludedTaskIds,
      });
      const leftover = await this.myTasks.leftoverEntry(tx, {
        projectIds,
        assigneeId: command.actorUserId,
        excludedTaskIds,
      });
      return {
        page,
        pageProjectIds,
        modules,
        features,
        assignees,
        publishedRecordCounts,
        groupRoles,
        linkCounts,
        stats,
        leftover,
      };
    });

    const projects = await this.projects.list(data.pageProjectIds);
    const projectNameById = new Map(
      projects.map((project) => [project.id, project.name]),
    );
    const moduleNameById = new Map(
      data.modules.map((item) => [item.moduleId, item.name]),
    );
    const featureNameById = new Map(
      data.features.map((item) => [item.featureId, item.name]),
    );
    const userById = new Map(data.assignees.map((item) => [item.userId, item]));
    const publishedRecordCountByTask = new Map(
      data.publishedRecordCounts.map((item) => [item.taskId, item.count]),
    );
    const roleByTask = new Map<number, "MAIN" | "SOURCE">();
    const groupIdByTask = new Map<number, number>();
    for (const item of data.groupRoles) {
      if (!roleByTask.has(item.taskId)) {
        roleByTask.set(item.taskId, item.role);
        groupIdByTask.set(item.taskId, item.groupId);
      }
    }
    const linkCountByTask = new Map(
      data.linkCounts.map((item) => [item.taskId, item.count]),
    );

    const items: MyTaskItem[] = data.page.items.map((row) => {
      const projectName = projectNameById.get(row.projectId);
      if (projectName === undefined) {
        throw inconsistentError("任务缺少项目 " + String(row.projectId));
      }
      const moduleName = moduleNameById.get(row.moduleId);
      if (moduleName === undefined) {
        throw inconsistentError("任务缺少模块 " + String(row.moduleId));
      }
      const assignee = userById.get(row.assigneeId);
      if (assignee === undefined) {
        throw inconsistentError("任务负责人不存在 " + String(row.assigneeId));
      }
      let featureName: string | null = null;
      if (row.featureId !== null) {
        const name = featureNameById.get(row.featureId);
        if (name === undefined) {
          throw inconsistentError("任务缺少功能 " + String(row.featureId));
        }
        featureName = name;
      }
      // 计数为 0 的任务不出现于端口结果，按缺席补 0（裁决修订 D-1）。
      const publishedRecordCount =
        publishedRecordCountByTask.get(row.taskId) ?? 0;
      return {
        taskId: row.taskId,
        code: row.code,
        title: row.title,
        projectId: row.projectId,
        projectName,
        moduleId: row.moduleId,
        moduleName,
        featureId: row.featureId,
        featureName,
        scopeType: row.scopeType,
        workStatus: row.workStatus,
        lifecycleStatus: row.lifecycleStatus,
        assignee: toUserRef(assignee),
        updatedAt: row.updatedAt.toISOString(),
        priority: row.priority,
        dueAt: row.dueAt === null ? null : row.dueAt.toISOString(),
        completedAt:
          row.completedAt === null ? null : row.completedAt.toISOString(),
        creatorId: row.creatorId,
        githubLinkCount: linkCountByTask.get(row.taskId) ?? 0,
        hasPublishedRecord: publishedRecordCount > 0,
        groupRole: roleByTask.get(row.taskId) ?? null,
        groupId: groupIdByTask.get(row.taskId) ?? null,
      };
    });

    return {
      items,
      nextCursor:
        data.page.nextTaskId === null
          ? null
          : this.cursor.encode({
              actorUserId: command.actorUserId,
              namespace: "MY_TASKS",
              filterKey,
              afterId: data.page.nextTaskId,
            }),
      hasMore: data.page.hasMore,
      stats: data.stats,
      leftoverCount: data.leftover.count,
      leftoverSample:
        data.leftover.sample === null
          ? null
          : {
              recordCode: data.leftover.sample.recordCode,
              summary:
                data.leftover.sample.contentPrefix +
                (data.leftover.sample.truncated ? "…" : ""),
            },
    };
  }

  private decodeCursor(
    cursor: string | undefined,
    actorUserId: number,
    filterKey: string,
  ): number | null {
    try {
      return this.cursor.decode(cursor, {
        actorUserId,
        namespace: "MY_TASKS",
        filterKey,
      });
    } catch (error) {
      if (error instanceof AggregateReadCursorError) {
        throw invalidCursorError();
      }
      throw error;
    }
  }
}
