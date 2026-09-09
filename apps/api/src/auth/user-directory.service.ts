import { Injectable } from "@nestjs/common";
import type { UserDirectoryItem } from "@inpulse/api-contract";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { SessionAuthService } from "./session-auth.service.js";
import { PostgresUserDirectoryRepository } from "./user-directory.repository.js";

/**
 * 读取创建项目时可选的启用用户目录。身份解析与目录查询共用同一个事务，
 * 避免在两个事务之间出现停用/注销竞态；匿名或停用返回 undefined。
 */
@Injectable()
export class UserDirectoryService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly sessionAuthService: SessionAuthService,
    private readonly repository: PostgresUserDirectoryRepository,
  ) {}

  async getDirectory(
    cookieHeader: string | undefined,
  ): Promise<readonly UserDirectoryItem[] | undefined> {
    return this.unitOfWork.run(async (tx) => {
      const actor = await this.sessionAuthService.resolveActorInTransaction(
        tx,
        cookieHeader,
      );
      if (actor === undefined) {
        return undefined;
      }
      return this.repository.findActiveDirectory(tx);
    });
  }
}
