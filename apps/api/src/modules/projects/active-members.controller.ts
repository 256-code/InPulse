import { Controller, Get, Req, Res, Inject } from "@nestjs/common";
import { getHeader, type HttpHeaderBag } from "../../auth/csrf.http.js";
import { ContractPath, Operation } from "../../http/contract.decorators.js";
import { ActiveMembersService } from "./active-members.service.js";
@Controller("projects")
export class ActiveMembersController {
  constructor(
    @Inject(ActiveMembersService)
    private readonly service: ActiveMembersService,
  ) {}
  @Get(":projectId/active-members")
  @Operation("listActiveProjectMembers")
  list(
    @Req() req: { headers: HttpHeaderBag },
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): unknown },
    @ContractPath("listActiveProjectMembers") path: { projectId: number },
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.service.list(getHeader(req.headers, "cookie"), path.projectId);
  }
}
