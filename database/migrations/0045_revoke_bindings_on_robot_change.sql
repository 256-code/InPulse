SET LOCAL ROLE app_owner;

-- ADR-078：更换机器人（bot_id 变化）时解除全部企业微信绑定。
-- 口径：
--   1. 触发条件由调用方（管理员保存机器人配置的同一事务）判定：保存的 bot_id
--      与现存的差异即视为「更换机器人」；仅轮换 secret 或调整 botProfileUrl 不触发。
--   2. 原因：企业微信智能机器人的推送要求成员与机器人先有一次主动对话（群为
--      群内先有人 @ 机器人）激活；更换机器人后旧绑定必然无法投递，显式解除
--      绑定让成员重新走绑定码流程，同时完成对新机器人的对话激活。
--   3. 函数在调用方事务内批量流转：app.user_wecom_bindings 与
--      app.project_wecom_groups 的 ACTIVE 行全部置为 REVOKED（保留历史，
--      不物理删除）；未完成的群投递由桥接侧投递改造（ADR-077 第二批）按
--      绑定状态处理，本函数不触碰 app.wecom_group_deliveries。
--   4. 返回解除计数，供审计留痕与保存响应展示；函数 SECURITY DEFINER 且
--      PUBLIC 执行权被回收，API 进程以 app_runtime 角色调用；函数不做任何
--      网络调用。

CREATE FUNCTION app.revoke_wecom_bindings_on_robot_change()
RETURNS TABLE (
  revoked_user_bindings INTEGER,
  revoked_project_groups INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_user_bindings INTEGER := 0;
  v_project_groups INTEGER := 0;
BEGIN
  UPDATE app.user_wecom_bindings
     SET status = 'REVOKED',
         revoked_at = now(),
         updated_at = now(),
         row_version = row_version + 1
   WHERE status = 'ACTIVE';
  GET DIAGNOSTICS v_user_bindings = ROW_COUNT;

  UPDATE app.project_wecom_groups
     SET status = 'REVOKED',
         revoked_at = now(),
         updated_at = now(),
         row_version = row_version + 1
   WHERE status = 'ACTIVE';
  GET DIAGNOSTICS v_project_groups = ROW_COUNT;

  RETURN QUERY SELECT v_user_bindings, v_project_groups;
END;
$$;

REVOKE ALL ON FUNCTION app.revoke_wecom_bindings_on_robot_change() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.revoke_wecom_bindings_on_robot_change() TO app_runtime;

-- 部署校验：函数的定义者、显式 ACL 与最小授权必须同时成立。
DO $$
DECLARE
  function_security_definer BOOLEAN;
  function_owner TEXT;
  function_has_explicit_acl BOOLEAN;
  runtime_function_execute BOOLEAN;
BEGIN
  SELECT p.prosecdef, pg_get_userbyid(p.proowner), p.proacl IS NOT NULL
    INTO function_security_definer, function_owner, function_has_explicit_acl
    FROM pg_proc p
   WHERE p.oid =
     'app.revoke_wecom_bindings_on_robot_change()'::regprocedure;

  IF function_security_definer IS NULL
     OR NOT function_security_definer
     OR function_owner <> 'app_owner'
     OR NOT function_has_explicit_acl THEN
    RAISE EXCEPTION
      'app.revoke_wecom_bindings_on_robot_change must be SECURITY DEFINER owned by app_owner with explicit ACL';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(p.proacl) AS acl
     WHERE p.oid =
       'app.revoke_wecom_bindings_on_robot_change()'::regprocedure
       AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION
      'PUBLIC must not execute app.revoke_wecom_bindings_on_robot_change';
  END IF;

  SELECT has_function_privilege(
           'app_runtime',
           'app.revoke_wecom_bindings_on_robot_change()',
           'EXECUTE'
         )
    INTO runtime_function_execute;
  IF NOT runtime_function_execute THEN
    RAISE EXCEPTION
      'app_runtime must execute app.revoke_wecom_bindings_on_robot_change';
  END IF;
END;
$$;
