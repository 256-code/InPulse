SET LOCAL ROLE app_owner;

-- F-22 草稿删除：app_runtime 只有 change_records 的 SELECT/INSERT/UPDATE，没有 DELETE
-- —— 已发布/已作废记录必须由数据库挡住物理删除（AGENTS.md 第 6 节不变量）。
-- 草稿（status='DRAFT'、无编号、无版本、不产生投影）不属于业务历史，允许删除；
-- 为不给 app_runtime 放开整表 DELETE，把删除收进一个 SECURITY DEFINER 函数：
-- 函数自己校验状态与行版本，只授予 EXECUTE，权限面比整表授权更窄。
--
-- 调用方（RecordDraftsService.remove）已按 project -> module -> feature -> changeRecord
-- 的锁序取过锁，并在同一事务内调用本函数；行版本不一致返回 false，由服务端映射 409。
-- 子表外键均为 ON DELETE restrict，必须按依赖顺序先删子行。

CREATE FUNCTION app.delete_change_record_draft(
  p_project_id INTEGER,
  p_record_id INTEGER,
  p_expected_row_version INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  target app.change_records%ROWTYPE;
BEGIN
  SELECT *
    INTO target
    FROM app.change_records
   WHERE id = p_record_id
     AND project_id = p_project_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  IF target.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'change record % is not a draft', p_record_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF target.row_version <> p_expected_row_version THEN
    RETURN FALSE;
  END IF;
  -- 遗留项行只在发布时建立（assert_change_record_versions 也要求草稿没有版本）。
  -- 草稿一旦出现遗留项行，说明状态机已被破坏，这里宁可报错也不静默连带删除。
  IF EXISTS (
    SELECT 1
      FROM app.change_record_leftover_items
     WHERE record_id = p_record_id
       AND project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'draft change record % has leftover items', p_record_id
      USING ERRCODE = 'check_violation';
  END IF;
  DELETE FROM app.change_record_external_links
   WHERE change_record_id = p_record_id
     AND project_id = p_project_id;
  DELETE FROM app.change_record_feature_impacts
   WHERE change_record_id = p_record_id
     AND project_id = p_project_id;
  DELETE FROM app.change_records
   WHERE id = p_record_id
     AND project_id = p_project_id
     AND status = 'DRAFT';
  RETURN TRUE;
END
$function$;

REVOKE ALL ON FUNCTION app.delete_change_record_draft(INTEGER, INTEGER, INTEGER)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_change_record_draft(INTEGER, INTEGER, INTEGER)
  TO app_runtime;
