import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { SessionAuthService } from "./session-auth.service.js";
import {
  type CurrentUserProfile,
  PostgresUserProfileRepository,
} from "./user-profile.repository.js";

/**
 * 读取当前登录用户资料。身份解析与资料查询共用同一个事务，
 * 避免在两个事务之间出现停用/改密竞态窗口。
 */
@Injectable()
export class MeService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly sessionAuthService: SessionAuthService,
    private readonly userProfileRepository: PostgresUserProfileRepository,
  ) {}

  async getCurrentUser(
    cookieHeader: string | undefined,
  ): Promise<CurrentUserProfile | undefined> {
    return this.unitOfWork.run(async (tx) => {
      const actor = await this.sessionAuthService.resolveActorInTransaction(
        tx,
        cookieHeader,
      );
      if (actor === undefined) {
        return undefined;
      }
      return this.userProfileRepository.findActiveById(tx, actor.userId);
    });
  }
}
