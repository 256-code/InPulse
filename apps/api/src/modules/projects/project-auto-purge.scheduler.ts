import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { ProjectAutoPurgeService } from "./project-auto-purge.service.js";

export const PROJECT_AUTO_PURGE_FIRST_DELAY_MS = 60_000;
export const PROJECT_AUTO_PURGE_INTERVAL_MS = 60 * 60 * 1000;
export const PROJECT_AUTO_PURGE_RETRY_DELAY_MS = 60_000;

/**
 * ADR-055：ProjectManagementModule 启动后的后台「保留期到期自动彻底删除」调度器。
 *
 * 与 Session 清理调度同一形态：测试环境不启动，避免 vitest 进程被后台定时器挂住；
 * 生产环境首跑延迟 1 分钟，成功后每小时执行一次，失败后 1 分钟重试。
 */
@Injectable()
export class ProjectAutoPurgeScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProjectAutoPurgeScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly service: ProjectAutoPurgeService) {}

  onModuleInit(): void {
    if (
      process.env["NODE_ENV"] === "test" ||
      process.env["PROJECT_AUTO_PURGE_ENABLED"] === "false"
    ) {
      return;
    }
    this.schedule(PROJECT_AUTO_PURGE_FIRST_DELAY_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runOnce();
    }, delayMs);
    this.timer.unref();
  }

  private async runOnce(): Promise<void> {
    let nextDelay = PROJECT_AUTO_PURGE_INTERVAL_MS;
    try {
      const result = await this.service.run();
      if (
        result.purgedProjectIds.length > 0 ||
        result.failedProjectIds.length > 0
      ) {
        this.logger.log(
          `保留期到期的项目自动彻底删除：候选 ${result.candidates} 个，` +
            `已删除 [${result.purgedProjectIds.join(", ")}]，` +
            `跳过 [${result.skippedProjectIds.join(", ")}]，` +
            `失败 [${result.failedProjectIds.join(", ")}]`,
        );
      }
    } catch (error: unknown) {
      nextDelay = PROJECT_AUTO_PURGE_RETRY_DELAY_MS;
      this.logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      this.schedule(nextDelay);
    }
  }
}
