SET LOCAL ROLE app_owner;

-- ADR-034 / F-10.3：迁移 0016 新增 app.project_archive_requests 与序列
-- app.project_archive_requests_id_seq，但没有同步备份角色授权，导致 `pg_dump`
-- 在一致性快照开始时对 dump 范围内全部表加 ACCESS SHARE 锁时对该表以 42501
-- 失败（本迁移前的实测行为：apps/ops 备份集成测试直接报
-- "pg_dump: permission denied for table project_archive_requests"）。
--
-- 授权范围与 0007_backup_role_pg_dump_grants.sql、0014_sso_backup_grants.sql
-- 保持一致，只补只读：
--   1. 表级 SELECT —— pg_dump 对 dump 范围内全部表执行
--      `LOCK TABLE ... IN ACCESS SHARE MODE`，表级锁定要求表级 SELECT，
--      列级授权不满足该检查；
--   2. 序列 USAGE, SELECT —— pg_dump 需要读取序列的 last_value / is_called。
--
-- 红线不变：app_backup 对 app.project_archive_requests 只有只读权限，没有任何
-- 写权限、DDL 或 owner 成员资格；该表保存的归档申请理由与决定说明在备份产物
-- 中与业务库同权限保护，备份包本身按 F-10.3 加密。
--
-- ⚠ 人工复核项（2026-09-17）：沿用 0014 建立的 fail closed 策略——每张新表都
-- 必须显式补一条备份授权迁移，而不是给 app_owner 设置
-- `ALTER DEFAULT PRIVILEGES ... TO app_backup` 自动授权，使每张新表是否可被
-- 备份角色读取都先经过一次人工评审。
GRANT SELECT ON app.project_archive_requests TO app_backup;

GRANT USAGE, SELECT ON SEQUENCE app.project_archive_requests_id_seq TO app_backup;
