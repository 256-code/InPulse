SET LOCAL ROLE app_owner;

-- ADR-051：项目彻底删除（purge）——系统管理员对「已经软删除」的项目执行
-- 不可撤销的物理删除，只保留 SYSTEM 审计链上的一条 `project.purge` 记录。
--
-- 背景：ADR-049 把删除改为软删除，理由之一是「物理删除要么删掉业务历史与审计链，
-- 要么在同一事务里按外键顺序删光 12 张子表」。用户 2026-09-28 明确要求提供
-- 「彻底删除」，因此本迁移把那条被推迟的物理删除路径补齐，边界如下：
--
--   1. 只能删除 `deleted_at IS NOT NULL` 的项目：彻底删除是软删除的第二步，
--      数据库侧同样 fail closed（否则会绕过 ADR-049 的删除权限口径直接抹库）。
--   2. 删除范围是该项目的全部业务行与它自己的 `PROJECT:<id>` 审计链：业务历史
--      随项目一起消失（这正是「彻底删除」的语义），SYSTEM 链不受影响。
--   3. 删除由 `SECURITY DEFINER` 函数一次完成：`app_runtime` 在业务表上没有
--      DELETE 权限（0001 只授 INSERT/SELECT/UPDATE），把 DELETE 逐表授出去会
--      永久放大运行时的写权限；函数是唯一的窄口，且只接受项目 ID。
--   4. `modules_protect_unclassified` 会在删除未分类模块时抛错（防止误删项目
--      引导模块）。项目彻底删除必须连带删除它，因此该触发器改为「仅当同一事务
--      内 `app.purge_project_id` 等于本行项目 ID 时放行」——豁免只能由本函数
--      通过事务级 `set_config(..., true)` 打开，函数返回前复位，其他任何路径
--      仍然 fail closed。
--   5. 不回收项目编码：`app.code_sequences` 属于项目自身数据，随项目一起删除；
--      `projects.code` 的唯一约束与编码空间不对已删除项目保留历史，编码是否
--      复用由后续新建项目时的序列状态决定（ADR-051 第 4 节）。
--
-- 删除顺序与 `scripts/purge-test-data.mjs` 的夹具清理顺序一致（由外键层级
-- 决定，从叶子表到 `app.projects`），并在同一事务内完成；延迟约束触发器
-- `projects_bootstrap_complete` / `project_members_bootstrap_complete` /
-- `project_members_leader_complete` 在提交时因项目行已不存在而直接返回。

-- 触发器签名与既有定义一致（返回 trigger），只增加 purge 事务内的放行分支。
CREATE OR REPLACE FUNCTION app.protect_unclassified_module()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'app'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.kind = 'UNCLASSIFIED' THEN
    -- ADR-051：项目彻底删除（app.purge_project）在同一事务内先设置项目 ID，
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

  -- 只允许对已软删除的项目执行；未删除时抛错，避免绕过 ADR-049 的删除权限。
  IF NOT EXISTS (
    SELECT 1
      FROM app.projects p
     WHERE p.id = p_project_id
       AND p.deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'project % is not soft deleted', p_project_id
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

  -- 项目自己的审计链随项目一起消失；SYSTEM 链只新增一条 project.purge（由 API 写）。
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

-- 部署校验：函数存在、属于 app_owner、且只对运行时开放执行权限。
DO $$
DECLARE
  owner_name TEXT;
  runtime_can_execute BOOLEAN;
  public_can_execute BOOLEAN;
BEGIN
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
