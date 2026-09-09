import { randomUUID } from "node:crypto";

import { Controller, Get, Res } from "@nestjs/common";

import { Operation } from "../http/contract.decorators.js";
import { HealthService } from "./health.service.js";

interface HealthControllerResponse {
  status(code: number): unknown;
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
  readonly requestId: string;
}

/**
 * 技术设计 §11.3：
 * - `/health/live` 只确认进程事件循环正常，不访问数据库；
 * - `/health/ready` 验证数据库可连接且迁移版本存在，未就绪返回 503。
 *
 * Controller 不直接访问数据库，就绪检查委托给 `HealthService`。
 */
@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Operation("getHealth")
  @Get()
  check(): { status: "ok" } {
    return { status: "ok" };
  }

  @Operation("getHealthLive")
  @Get("live")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Operation("getHealthReady")
  @Get("ready")
  async ready(
    @Res({ passthrough: true }) response: HealthControllerResponse,
  ): Promise<{ status: "ok" } | ErrorResponseDto> {
    try {
      await this.healthService.checkReadiness();
    } catch {
      response.status(503);
      return {
        code: "SERVICE_NOT_READY",
        message: "服务未就绪：数据库连接或迁移版本检查失败",
        details: {},
        requestId: randomUUID(),
      };
    }
    return { status: "ok" };
  }
}
