import { Injectable } from "@nestjs/common";
import type { MyOrganizationMembersResponse } from "@inpulse/api-contract";

import { SessionAuthService } from "../auth/session-auth.service.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { OrganizationRepository } from "./organization.repository.js";

/**
 * ADR-081 同组织可见：身份解析与成员查询共用同一个事务；
 * 匿名、停用或无效 Session 返回 undefined（401）。未分配组织返回空列表。
 */
@Injectable()
export class OrganizationMembersService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly sessionAuthService: SessionAuthService,
    private readonly repository: OrganizationRepository,
  ) {}

  async getMyMembers(
    cookieHeader: string | undefined,
  ): Promise<MyOrganizationMembersResponse | undefined> {
    return this.unitOfWork.run(async (tx) => {
      const actor = await this.sessionAuthService.resolveActorInTransaction(
        tx,
        cookieHeader,
      );
      if (actor === undefined) {
        return undefined;
      }
      const organizationId = await this.repository.findUserOrganizationId(
        tx,
        actor.userId,
      );
      if (organizationId === null) {
        return { organization: null, items: [] };
      }
      const organization = await this.repository.find(tx, organizationId);
      if (organization === undefined) {
        return { organization: null, items: [] };
      }
      const items = await this.repository.listActiveMembers(tx, organizationId);
      return {
        organization: { id: organization.id, name: organization.name },
        items,
      };
    });
  }
}
