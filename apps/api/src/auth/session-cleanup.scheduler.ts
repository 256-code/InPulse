import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { SessionCleanupService } from "./session-cleanup.service.js";

export const SESSION_CLEANUP_FIRST_DELAY_MS = 60_000;
export const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const SESSION_CLEANUP_RETRY_DELAY_MS = 60_000;

/**
 * AuthModule 启动后的后台 Session 清理调度器。
 *
 * 测试环境不启动，避免 vitest 进程被后台定时器挂住；生产环境首跑延迟
 * 1 分钟，成功后每小时执行一次，失败后 1 分钟重试。
 */
@Injectable()
export class SessionCleanupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupScheduler.name);
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  constructor(private readonly service: SessionCleanupService) {}

  onModuleInit(): void {
    if (
      process.env["NODE_ENV"] === "test" ||
      process.env["SESSION_CLEANUP_ENABLED"] === "false"
    ) {
      return;
    }
    this.schedule(SESSION_CLEANUP_FIRST_DELAY_MS);
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
    let nextDelay = SESSION_CLEANUP_INTERVAL_MS;
    try {
      await this.service.run();
    } catch (error: unknown) {
      nextDelay = SESSION_CLEANUP_RETRY_DELAY_MS;
      this.logger.error(
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      this.schedule(nextDelay);
    }
  }
}
