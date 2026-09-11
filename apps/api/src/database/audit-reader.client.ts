import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { resolveDatabaseUrl } from "@inpulse/database/config";

/**
 * F-08 原始审计读取的独立 `audit_reader` 连接池（技术设计 §7）。
 * 惰性创建：只有第一次真正发生审计读取时才解析连接配置并建池，生产缺失
 * Secret、路径越界或权限不合规时在首次读取 fail closed，不阻断进程启动
 * （与审计 HMAC keyring 同一策略）；池随模块销毁关闭。
 * 本类不暴露 drizzle / 写能力，只允许参数化只读查询。
 */
@Injectable()
export class AuditReaderDatabase implements OnModuleDestroy {
  private client: Promise<DatabaseClient> | undefined;

  async readSql(): Promise<DatabaseClient["sql"]> {
    this.client ??= resolveDatabaseUrl("AUDIT").then((url) =>
      createDatabaseClient(url, {
        applicationName: "inpulse-api-audit-reader",
        maxConnections: 4,
      }),
    );
    return (await this.client).sql;
  }

  async onModuleDestroy(): Promise<void> {
    const client = await this.client?.catch(() => undefined);
    await client?.close();
  }
}
