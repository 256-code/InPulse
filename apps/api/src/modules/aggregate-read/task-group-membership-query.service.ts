import { Inject, Injectable } from "@nestjs/common";

import type { TaskGroupMembershipResponse } from "@inpulse/api-contract";

import {
  PostgresUnitOfWork,
  type UnitOfWork,
} from "../../database/unit-of-work.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { TaskGroupMembershipReadPort } from "../task-groups/index.js";

/**
 * R-5 任务卡片聚合关系批量查询（A 裁决 §10.4）。
 *
 * 只读：先取服务端 AuthorizedProjectScope，再通过 C 域 TaskGroupMembershipReadPort
 * 读取 ACTIVE 组内的 ACTIVE 成员关系。无权、不存在、已解除或不在授权项目内的
 * 任务一律不入结果，不返回 404、不泄露资源存在性；数量 / 格式 / 重复校验
 * 由契约层收口为 422（A 裁决 §10.4）。
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
    @Inject(TaskGroupMembershipReadPort)
    private readonly membership: TaskGroupMembershipReadPort,
    @Inject(PostgresUnitOfWork) private readonly unitOfWork: UnitOfWork,
  ) {}

  async list(
    command: TaskGroupMembershipQueryCommand,
  ): Promise<TaskGroupMembershipResponse> {
    const scope = await this.projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    return this.unitOfWork.run(async (tx) => {
      const roles = await this.membership.listGroupRoles(
        tx,
        scope.projectIds,
        command.taskIds,
      );
      const items = [...roles]
        .sort((left, right) => left.taskId - right.taskId)
        .map((row) => ({
          taskId: row.taskId,
          groupId: row.groupId,
          groupRole: row.role,
        }));
      return { items };
    });
  }
}
