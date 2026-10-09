SET LOCAL ROLE app_owner;

-- ADR-058：取消任务 = 删除任务（软删除），不物理删除任何业务历史。
-- 背景：`app.tasks` 被 change_records / task_status_history / task_external_links /
-- task_group_members / task_feature_impacts / task_assignees / leftover_task_links
-- 七张表以 RESTRICT 外键引用，审计链又按 ADR-008 只追加不可回滚；物理删除要么删掉
-- 任务历史与审计链，要么在同一事务里按外键顺序删光子表，两者都与「业务历史默认通过
-- 归档、作废或新版本保留」（AGENTS.md 第 6 节）冲突。因此删除只标记状态：
--   * `deleted_at` / `deleted_by` 成对写入，表示「谁在什么时候删除了这个任务」；
--   * 行、状态历史、功能影响、负责人、外部链接与审计链全部保留，仅从列表、详情、
--     看板、统计、搜索与全部任务级读写中排除（读路径统一带 deleted_at IS NULL）；
--   * 删除命令在同一事务内解除该任务的外部链接关联、作废其已发布迭代记录、
--     解除其聚合组成员关系（主任务则拒绝删除），并写审计与项目动态。
--
-- 口径与边界：
--   1. 两列必须同时为空或同时有值：只写一半会让「谁删的」永久丢失，
--      由 tasks_deleted_state_check 拒绝；
--   2. 删除不放开任何唯一约束：`tasks_project_code_unique` 保持不变，已删除任务
--      仍占用任务编码（编码是审计与迭代记录里引用的历史标识，不允许被后来者复用）；
--   3. 本迁移只加列与约束，不改已有列、不改数据、不递增 row_version、不写审计
--      （属结构迁移）。存量的任务行 deleted_at 均为空，语义与迁移前一致；
--   4. 不新增索引：现有 tasks_project_status_idx 以 project_id 为首列，已删除任务
--      占比极低，deleted_at IS NULL 的过滤代价可忽略，部分索引收益不足以抵消维护面；
--   5. `app_runtime` 对 app.tasks 已有表级 SELECT/INSERT/UPDATE 授权（0001），
--      新列随之可见；`app_backup` 的表级 SELECT 同样覆盖新列，无需额外 GRANT。

ALTER TABLE app.tasks
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by INTEGER;

-- 删除者必须是真实存在的用户；删除任务的人可能随后被停用，但不能被物理删除，
-- 因此这里与 app.tasks.creator_id 一致使用 ON DELETE restrict。
ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_deleted_by_users_id_fk
  FOREIGN KEY (deleted_by) REFERENCES app.users(id)
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_deleted_state_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- 部署校验：迁移必须落在「每个已删除任务都有删除人」的状态上。
DO $$
DECLARE
  inconsistent INTEGER;
BEGIN
  SELECT count(*)
    INTO inconsistent
    FROM app.tasks
   WHERE (deleted_at IS NULL) <> (deleted_by IS NULL);

  IF inconsistent > 0 THEN
    RAISE EXCEPTION 'found % task(s) with inconsistent delete state', inconsistent;
  END IF;
END
$$;
