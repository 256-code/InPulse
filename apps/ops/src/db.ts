import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";

/**
 * 审计归档进程的数据库连接：固定使用 `audit_archive_writer` 角色
 * （仅 SELECT app.audit_logs / app.audit_chain_heads，无业务写与对象删除权限）。
 * 归档进程不做任何数据库写入，连接只用于读取。
 */
export function connectArchiveDatabase(databaseUrl: string): DatabaseClient {
  return createDatabaseClient(databaseUrl, {
    applicationName: "inpulse-ops-audit-archive",
    maxConnections: 2,
  });
}
