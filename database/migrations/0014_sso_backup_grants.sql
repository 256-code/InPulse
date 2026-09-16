SET LOCAL ROLE app_owner;

-- ADR-032 / F-10.3：迁移 0013 新增 app.sso_login_attempts 与序列
-- app.sso_login_attempts_id_seq，但没有同步备份角色授权，导致 `pg_dump` 在
-- 一致性快照开始时对 dump 范围内全部表加 ACCESS SHARE 锁时对该表以 42501
-- 失败（本迁移前的实测行为：apps/ops 备份集成测试直接报
-- "pg_dump: permission denied for table sso_login_attempts"）。
--
-- 授权范围与 0007_backup_role_pg_dump_grants.sql 保持一致，只补只读：
--   1. 表级 SELECT —— pg_dump 对 dump 范围内全部表执行
--      `LOCK TABLE ... IN ACCESS SHARE MODE`（含被 --exclude-table-data
--      排除数据的表），表级锁定要求表级 SELECT，列级授权不满足该检查；
--   2. 序列 USAGE, SELECT —— pg_dump 需要读取序列的 last_value / is_called。
--
-- 红线不变：app_backup 对 app.sso_login_attempts 只有只读权限，没有任何写
-- 权限、DDL 或 owner 成员资格；该表保存的一次性 state 哈希在备份产物中只
-- 保留结构，数据由 `--exclude-table-data=app.sso_login_attempts` 排除
-- （清单见 apps/ops/src/backup.ts 的 BACKUP_EXCLUDED_TABLE_DATA）。
--
-- ⚠ 人工复核项（2026-09-15）：新增表进入备份范围采用 fail closed 策略——
-- 每张新表都必须显式补一条备份授权迁移，而不是给 app_owner 设置
-- `ALTER DEFAULT PRIVILEGES ... TO app_backup` 自动授权。这样每张新表是否
-- 可被备份角色读取都会先经过一次人工评审；若后续改为默认授权，必须新增 ADR。
GRANT SELECT ON app.sso_login_attempts TO app_backup;

GRANT USAGE, SELECT ON SEQUENCE app.sso_login_attempts_id_seq TO app_backup;
