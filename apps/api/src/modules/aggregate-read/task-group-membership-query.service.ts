import { Inject, Injectable } from "@nestjs/common";

import type { TaskGroupMembershipResponse } from "@inpulse/api-contract";

import {
  PostgresUnitOfWork,
  type UnitOfWork,
} from "../../database/unit-of-work.js";
import { ChangeRecordReadPort } from "../change-records/index.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { TaskGroupMembershipReadPort } from "../task-groups/index.js";
import { TaskQueryPort } from "../tasks/index.js";

/**
 * R-5 任务记录标记批量读（A 裁决 §10.4，裁决修订 D-1 / §11.4）。
 *
 * 只读：先取服务端 AuthorizedProjectScope，再校验请求中哪些 taskId 属于有权项目
 * （TaskQueryPort.listByIds），然后读取 ACTIVE 组内的 ACTIVE 成员关系
 * （TaskGroupMembershipReadPort.listGroupRoles）与任务 → PUBLISHED 记录数映射
 * （ChangeRecordReadPort.countPublishedByTask）。
 *
 * 覆盖范围（D-1）：请求中每一个有权 taskId 都出现在结果中；未加入 ACTIVE 聚合组
 * （含已解除 DETACHED）的任务以 groupId / groupRole 为 null 返回，记录计数照常。
 * 无权、不存在（含跨项目）的任务不出现，不返回 404、不泄露资源存在性；
 * 数量 / 格式 / 重复校验由契约层收口为 422（A 裁决 §10.4）。
 * 事务：一次请求一个只读事务，不创建命令 UnitOfWork、不取任何行锁、不写投影。
 */
export interface TaskGroupMembershipQueryCommand {
  readonly actorUserId: number;
  readonly taskIds: readonly number[];
}

@Injectable()
export class TaskGroupMembershipQueryService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly projectAccess: ProjectAccessQueryPort,
    @Inject(TaskQueryPort) private readonly tasks: TaskQueryPort,
    @Inject(TaskGroupMembershipReadPort)
    private readonly membership: TaskGroupMembershipReadPort,
    @Inject(ChangeRecordReadPort)
    private readonly records: ChangeRecordReadPort,
    @Inject(PostgresUnitOfWork) private readonly unitOfWork: UnitOfWork,
  ) {}

  async list(
    command: TaskGroupMembershipQueryCommand,
  ): Promise<TaskGroupMembershipResponse> {
    const scope = await this.projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    return this.unitOfWork.run(async (tx) => {
      const tasks = await this.tasks.listByIds(
        tx,
        scope.projectIds,
        command.taskIds,
      );
      const authorizedTaskIds = tasks
        .map((task) => task.taskId)
        .sort((left, right) => left - right);
      if (authorizedTaskIds.length === 0) {
        return { items: [] };
      }
      const roles = await this.membership.listGroupRoles(
        tx,
        scope.projectIds,
        authorizedTaskIds,
      );
      const counts = await this.records.countPublishedByTask(
        tx,
        scope.projectIds,
        authorizedTaskIds,
      );
      const roleByTask = new Map(roles.map((row) => [row.taskId, row]));
      const countByTask = new Map(counts.map((row) => [row.taskId, row.count]));
      const items = authorizedTaskIds.map((taskId) => {
        const role = roleByTask.get(taskId);
        return {
          taskId,
          groupId: role?.groupId ?? null,
          groupRole: role?.role ?? null,
          publishedRecordCount: countByTask.get(taskId) ?? 0,
        };
      });
      return { items };
    });
  }
}
