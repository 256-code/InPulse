SET LOCAL ROLE app_owner;

-- ADR-062：项目删除由「软删除 + 可选彻底删除」改为「一次物理删除」。
--
-- 2026-10-09 用户指示：项目删除就是删除，没有「先软删除再彻底删除」两步，也不
-- 保留 30 天保留期。因此：
--   1. `0030` 引入的 `deleted_at` / `deleted_by` 两列与配套约束整体下线，
--      `app.projects` 不再有「已删除」状态位（生命周期仍是 ADR-043 的三态）。
--   2. 存量的软删除项目在本迁移内**恢复为存活项目**（清空两列、递增
--      `row_version`），避免出现「删除标记消失但项目已在别处被当作已删除」
--      的半状态：演示库当时只有 1 行（id=124），恢复后与用户看到的
--      「项目还在」完全一致。
--   3. `app.purge_project` 的门禁由「必须已软删除」换成「必须真实存在」，
--      仍是唯一的窄口：`app_runtime` 在业务表上没有 DELETE 权限，DELETE 只
--      发生在这个 SECURITY DEFINER 函数内部，权限模型不变。
--   4. 删除范围不变（业务行 + 项目自己的 `PROJECT:<id>` 审计链），项目编码、
--      成员关系、迭代记录与审计链随项目一起消失；唯一留痕是 API 在同一事务里
--      追加到 SYSTEM 链的一条 `project.delete`（由 API 写，不在本函数内）。
--
-- 删除顺序与 `scripts/purge-test-data.mjs` 的夹具清理顺序一致（由外键层级决定，
-- 从叶子表到 `app.projects`），并在同一事务内完成；延迟约束触发器
-- `projects_bootstrap_complete` / `project_members_bootstrap_complete` /
-- `project_members_leader_complete` 在提交时因项目行已不存在而直接返回。

-- 1) 恢复存量软删除项目。`projects_row_version` 触发器要求每次 UPDATE 恰好 +1。
UPDATE app.projects
   SET deleted_at = NULL,
       deleted_by = NULL,
       updated_at = now(),
       row_version = row_version + 1
 WHERE deleted_at IS NOT NULL;

-- 上面的 UPDATE 会让延迟约束触发器 `projects_bootstrap_complete` 留下待提交事件，
-- 而待提交事件存在时 `ALTER TABLE app.projects` 会被拒绝（55006
-- `cannot ALTER TABLE "projects" because it has pending trigger events`，2026-10-09
-- 在演示库实测）。先就地结算延迟事件，再改表结构（与 ADR-030 对模块编号回填的
-- 处理同一手法）。
SET CONSTRAINTS ALL IMMEDIATE;

-- 2) 项目管理器的唯一入口：删除存活项目。
--    触发器签名与既有定义一致（返回 trigger），purge 事务内的放行分支不变。
CREATE OR REPLACE FUNCTION app.protect_unclassified_module()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.kind = 'UNCLASSIFIED' THEN
    -- ADR-062：项目物理删除（app.purge_project）在同一事务内先设置项目 ID，
    -- 只为这一个项目放开未分类模块的删除防线。
    IF current_setting('app.purge_project_id', true) = OLD.project_id::text THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION 'the unclassified module cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END
$function$;

CREATE OR REPLACE FUNCTION app.purge_project(p_project_id INTEGER)
 RETURNS TABLE (
   modules INTEGER,
   features INTEGER,
   tasks INTEGER,
   change_records INTEGER,
   audit_logs INTEGER,
   members INTEGER,
   total INTEGER
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app'
AS $function$
DECLARE
  v_removed INTEGER;
  v_modules INTEGER := 0;
  v_features INTEGER := 0;
  v_tasks INTEGER := 0;
  v_change_records INTEGER := 0;
  v_audit_logs INTEGER := 0;
  v_members INTEGER := 0;
  v_total INTEGER := 0;
BEGIN
  IF p_project_id IS NULL OR p_project_id <= 0 THEN
    RAISE EXCEPTION 'project id must be a positive integer'
      USING ERRCODE = 'check_violation';
  END IF;

  -- 项目必须真实存在；`FOR UPDATE` 让同项目的写路径在删除期间排队等待，
  -- 并发的两次删除只有一个能命中这一行。
  IF NOT EXISTS (
    SELECT 1
      FROM app.projects p
     WHERE p.id = p_project_id
     FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'project % not found', p_project_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 事务级豁免开关：只对本次 purge 的项目放开未分类模块删除防线。
  PERFORM set_config('app.purge_project_id', p_project_id::text, true);

  DELETE FROM app.change_record_version_leftovers r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.change_record_external_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.change_record_feature_impacts r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.change_record_versions r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.leftover_task_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.change_record_leftover_items r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.change_records r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_change_records := v_change_records + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.task_feature_impacts r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.task_group_members r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.task_status_history r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.task_assignees r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.task_external_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.tasks r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_tasks := v_tasks + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.task_groups r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.feature_external_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.features r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_features := v_features + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.project_external_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  -- 未分类模块由上面的触发器豁免放行；其余模块没有删除防线。
  DELETE FROM app.modules m WHERE m.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_modules := v_modules + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.project_archive_requests r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.code_sequences r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.project_members r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_members := v_members + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.notifications r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.activity_projection r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.search_projection r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.external_links r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  -- 项目自己的审计链随项目一起消失；SYSTEM 链只新增一条 project.delete（由 API 写）。
  DELETE FROM app.audit_logs r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_audit_logs := v_audit_logs + v_removed;
  v_total := v_total + v_removed;

  DELETE FROM app.audit_chain_heads r WHERE r.project_id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  v_total := v_total + v_removed;

  DELETE FROM app.projects r WHERE r.id = p_project_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed <> 1 THEN
    RAISE EXCEPTION 'project % disappeared during purge', p_project_id;
  END IF;

  PERFORM set_config('app.purge_project_id', '', true);

  RETURN QUERY
    SELECT v_modules,
           v_features,
           v_tasks,
           v_change_records,
           v_audit_logs,
           v_members,
           v_total;
END
$function$;

-- 只有运行时可调用；PUBLIC 默认的 EXECUTE 必须收回，避免任何角色都能抹库。
REVOKE ALL ON FUNCTION app.purge_project(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.purge_project(INTEGER) TO app_runtime;

-- 3) 下线软删除列与配套约束：`deleted_by` 先于 `deleted_at` 删除（外键在 deleted_by 上）。
ALTER TABLE app.projects DROP CONSTRAINT projects_deleted_state_check;
ALTER TABLE app.projects DROP CONSTRAINT projects_deleted_by_users_id_fk;
ALTER TABLE app.projects DROP COLUMN deleted_by;
ALTER TABLE app.projects DROP COLUMN deleted_at;

-- 部署校验：软删除列确实消失；函数存在、属于 app_owner、且只对运行时开放执行权限。
DO $$
DECLARE
  owner_name TEXT;
  runtime_can_execute BOOLEAN;
  public_can_execute BOOLEAN;
  leftover_columns INTEGER;
BEGIN
  SELECT count(*)
    INTO leftover_columns
    FROM information_schema.columns
   WHERE table_schema = 'app'
     AND table_name = 'projects'
     AND column_name IN ('deleted_at', 'deleted_by');

  IF leftover_columns > 0 THEN
    RAISE EXCEPTION 'app.projects still has soft delete columns';
  END IF;

  SELECT pg_get_userbyid(p.proowner)
    INTO owner_name
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app'
     AND p.proname = 'purge_project';

  IF owner_name IS NULL THEN
    RAISE EXCEPTION 'app.purge_project was not created';
  END IF;

  IF owner_name <> 'app_owner' THEN
    RAISE EXCEPTION 'app.purge_project must be owned by app_owner, got %', owner_name;
  END IF;

  SELECT has_function_privilege('app_runtime', 'app.purge_project(integer)', 'EXECUTE')
    INTO runtime_can_execute;
  SELECT has_function_privilege('public', 'app.purge_project(integer)', 'EXECUTE')
    INTO public_can_execute;

  IF NOT runtime_can_execute THEN
    RAISE EXCEPTION 'app_runtime must be able to execute app.purge_project';
  END IF;

  IF public_can_execute THEN
    RAISE EXCEPTION 'PUBLIC must not be able to execute app.purge_project';
  END IF;
END
$$;
