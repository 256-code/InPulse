SET LOCAL ROLE app_owner;

-- F-10.3 backup 服务（技术设计 v1.2.2 §11.5 第 1 步：pg_dump --format=custom）：
-- 为 app_backup 补齐 pg_dump 在一致性快照下必需的两类只读权限，使「表结构保留、
-- 数据排除」的加密逻辑备份在权限层可行：
--   1. 表级 SELECT —— pg_dump 在快照开始时对 dump 范围内全部表执行
--      `LOCK TABLE ... IN ACCESS SHARE MODE`（含 --schema-only，2026-09-11 实机验证），
--      表级锁定要求表级 SELECT；列级授权不满足该检查。
--   2. 序列 USAGE, SELECT —— pg_dump 需要读取每个序列的 last_value / is_called。
--
-- ⚠ 人工复核项（实现与设计原文的冲突记录，2026-09-11）：
-- 技术设计 §11.2 / §11.5 曾写「app_backup 显式无 user_sessions /
-- session_csrf_tokens / preauth_sessions SELECT」。该表述与 §11.5 第 1 步
-- 「表结构保留」+「任务使用 app_backup」不能同时成立：任何 pg_dump 都会锁定并
-- 读取这些对象，无权限时 pg_dump 以 42501 直接失败（本迁移前的实测行为）。
-- 本迁移按「备份必须可用」优先补齐只读权限，并保持三条红线不变：
--   - 三张会话表的数据仍由 `--exclude-table-data` 排除在备份文件之外（仅结构）；
--   - app_backup 对全部表始终没有写权限，也没有任何 DDL / owner 成员资格；
--   - 备份角色可读到的只是带独立 HMAC 密钥的会话 Token 哈希，不进入任何备份产物。
-- 技术设计文档的对应句子按仓库惯例保留为「生产前人工定案项」，由非作者评审确认。
GRANT SELECT ON
  app.user_sessions,
  app.session_csrf_tokens,
  app.preauth_sessions,
  app.auth_rate_limit_buckets
TO app_backup;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app TO app_backup;
