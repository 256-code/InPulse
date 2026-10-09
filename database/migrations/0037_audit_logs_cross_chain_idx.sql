SET LOCAL ROLE app_owner;

-- ADR-061：审计读取新增「全部记录（所有链）」跨链视图所需的跨链分页索引。
--
-- `GET /api/v1/audit-logs` 原先只支持单链读取（SYSTEM 链，或 `projectId`
-- 指定的 `PROJECT:<id>` 链），既有索引与主键都以单链为前提：
--   * 主键 (chain_id, sequence_no)；
--   * audit_logs_project_time_idx (project_id, occurred_at, sequence_no)；
--   * audit_logs_actor_time_idx (actor_id, occurred_at, sequence_no)。
-- 跨链视图的固定排序键是 (occurred_at DESC, chain_id DESC, sequence_no DESC)，
-- 上述索引的前导列都不是 occurred_at，无法按时间跨链有序扫描，只能全表
-- 扫描后排序。本迁移只补一条与排序键同形的索引，让默认（无筛选）与按
-- from/to、动作码过滤后的跨链页都能走索引扫描。
--
-- 口径与边界：
--   1. 只加索引：不改表结构、不改数据、不递增 row_version、不写审计；
--   2. 不新增授权：索引不改变表级权限，audit_reader 的只读 SELECT 照旧；
--   3. 降序声明与查询 ORDER BY 完全一致，PostgreSQL 正向扫描即可，避免
--      依赖反向扫描导致计划随版本波动；
--   4. 审计链只追加，索引随写入线性增长——这是跨链视图的既定代价，容量
--      评估见测试矩阵的跨链分页证据；
--   5. 单链读取路径不受影响：主键与既有索引继续服务原查询。
--
-- ⚠ 人工复核项：索引列序必须与跨链分页排序保持一致；接口改排序即须同步
-- 本索引（与 0008 的跨项目记录索引同一约定）。
CREATE INDEX audit_logs_occurred_at_chain_seq_idx
    ON app.audit_logs (occurred_at DESC, chain_id DESC, sequence_no DESC);
