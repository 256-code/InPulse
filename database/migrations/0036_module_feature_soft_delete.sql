SET LOCAL ROLE app_owner;

-- ADR-059：模块与功能增加删除能力，两者一律软删除，不物理删除任何业务历史。
-- 背景：ADR-044 / ADR-045 先后下线模块层与功能层的归档之后，两者只剩 ACTIVE，
-- 既没有归档也没有删除路径；唯一的移除方式是整项目彻底删除（ADR-051 的
-- app.purge_project）。本迁移补上「模块 / 功能自身的删除」这一层：
--   * `deleted_at` / `deleted_by` 成对写入，表示「谁在什么时候删除了它」；
--   * 行、功能、任务、迭代记录与审计链全部保留，仅从列表、详情、统计、搜索与
--     全部读路径中排除（读路径统一带 deleted_at IS NULL）；
--   * 删除模块时在同一事务内软删除其全部功能与全部任务（任务按 ADR-058 的单任务
--     语义处理：解除链接关联、作废该任务的已发布记录、解除聚合组来源关系），
--     删除功能时只处理其自身任务；模块 / 功能自身的已发布记录一并作废。
--
-- 口径与边界：
--   1. 两列必须同时为空或同时有值：只写一半会让「谁删的」永久丢失，
--      由 modules_deleted_state_check / features_deleted_state_check 拒绝；
--   2. 不放开任何唯一约束：modules_project_code_unique / features_project_code_unique
--      保持不变，已删除行仍占用编码（编码是审计与迭代记录里引用的历史标识）；
--      每项目恰好一个未分类模块的不变量（modules_one_unclassified_unique 与
--      assert_project_bootstrap）也不受影响——未分类模块禁止软删除（409），
--      且本迁移不改 kind；
--   3. app.protect_unclassified_module() 只拦 BEFORE DELETE（物理删除），
--      与这里的软删除并行生效，未分类模块的物理删除禁令原样保留；
--   4. 本迁移只加列与约束，不改已有列、不改数据、不递增 row_version、不写审计
--      （属结构迁移）。存量行的 deleted_at 均为空，语义与迁移前一致；
--   5. 不新增索引：列表查询由既有外键索引（modules_project_id_idx /
--      features_project_id_module_id_idx 等）驱动，deleted_at IS NULL 是索引后的
--      残余过滤，已删除占比极低，部分索引收益不足以抵消维护面；
--   6. 不新增授权：app_runtime 对 app.modules / app.features 已有表级
--      SELECT/INSERT/UPDATE（0001），软删除走 UPDATE；app_backup 的表级 SELECT
--      同样覆盖新列，无需额外 GRANT。

ALTER TABLE app.modules
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by INTEGER;

-- 删除者必须是真实存在的用户；删除模块的人可能随后被停用，但不能被物理删除，
-- 因此与 app.modules.created_by 一致使用 ON DELETE restrict。
ALTER TABLE app.modules
  ADD CONSTRAINT modules_deleted_by_users_id_fk
  FOREIGN KEY (deleted_by) REFERENCES app.users(id)
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE app.modules
  ADD CONSTRAINT modules_deleted_state_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

ALTER TABLE app.features
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_by INTEGER;

ALTER TABLE app.features
  ADD CONSTRAINT features_deleted_by_users_id_fk
  FOREIGN KEY (deleted_by) REFERENCES app.users(id)
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE app.features
  ADD CONSTRAINT features_deleted_state_check
  CHECK ((deleted_at IS NULL) = (deleted_by IS NULL));

-- 部署校验：迁移必须落在「每个已删除模块 / 功能都有删除人」的状态上。
DO $$
DECLARE
  inconsistent INTEGER;
BEGIN
  SELECT count(*)
    INTO inconsistent
    FROM app.modules
   WHERE (deleted_at IS NULL) <> (deleted_by IS NULL);

  IF inconsistent > 0 THEN
    RAISE EXCEPTION 'found % module(s) with inconsistent delete state', inconsistent;
  END IF;

  SELECT count(*)
    INTO inconsistent
    FROM app.features
   WHERE (deleted_at IS NULL) <> (deleted_by IS NULL);

  IF inconsistent > 0 THEN
    RAISE EXCEPTION 'found % feature(s) with inconsistent delete state', inconsistent;
  END IF;
END
$$;
