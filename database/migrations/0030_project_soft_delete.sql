SET LOCAL ROLE app_owner;

-- ADR-049：项目删除 = 项目退出全部可见范围（软删除），不物理删除任何业务历史。
-- 背景：`app.projects` 被 modules / tasks / change_records / activity_projection /
-- audit_logs / notifications / search_projection / project_members 等 12 张表以
-- RESTRICT 外键引用，审计链又按 ADR-008 只追加不可回滚；物理删除要么删掉业务历史与
-- 审计链，要么在同一事务里按外键顺序删光 12 张子表，两者都与「业务历史默认通过归档、
-- 作废或新版本保留」（AGENTS.md 第 6 节）冲突。因此删除只标记状态：
--   * `deleted_at` / `deleted_by` 成对写入，表示「谁在什么时候删除了这个项目」；
--   * 行、成员关系、任务、迭代记录、审计链与通知全部保留，仅从列表、详情、搜索、
--     动态与全部项目级读写中排除（服务端在 AuthorizedProjectScope 与
--     checkProjectForWrite 两个入口统一过滤，数据库侧不需要额外权限）。
--
-- 口径与边界：
--   1. 两列必须同时为空或同时有值：只写一半会让「谁删的」永久丢失，
--      由 projects_deleted_state_check 拒绝；
--   2. 删除不放开任何唯一约束：`projects_code_unique` 保持不变，已删除项目
--      仍占用项目编码（编码是审计与迭代记录里引用的历史标识，不允许被后来者复用）；
--   3. 本迁移只加列与约束，不改已有列、不改数据、不递增 row_version、不写审计
--      （属结构迁移）。存量的项目行 deleted_at 均为空，语义与迁移前一致；
--   4. `app_runtime` 对 app.projects 已有表级 SELECT/INSERT/UPDATE 授权（0001），
--      新列随之可见；`app_backup` 的表级 SELECT 同样覆盖新列，无需额外 GRANT。

ALTER TABLE app.projects
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by INTEGER;

-- 删除者必须是真实存在的用户；删除项目的人可能随后被停用，但不能被物理删除，
-- 因此这里与 app.projects.created_by 一致使用 ON DELETE restrict。
ALTER TABLE app.projects
  ADD CONSTRAINT projects_deleted_by_users_id_fk
  FOREIGN KEY (deleted_by) REFERENCES app.users(id)
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE app.projects
  ADD CONSTRAINT projects_deleted_state_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- 部署校验：迁移必须落在「每个已删除项目都有删除人且时间为正」的状态上。
DO $$
DECLARE
  inconsistent INTEGER;
BEGIN
  SELECT count(*)
    INTO inconsistent
    FROM app.projects
   WHERE (deleted_at IS NULL) <> (deleted_by IS NULL);

  IF inconsistent > 0 THEN
    RAISE EXCEPTION 'found % project(s) with inconsistent delete state', inconsistent;
  END IF;
END
$$;
