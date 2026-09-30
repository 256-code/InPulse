SET LOCAL ROLE app_owner;

-- 搜索结果跳转：投影行补出「打开结果自身页面」所需的所属模块 / 功能与所属记录。
--   * FEATURE 的落地页是 /projects/{p}/modules/{m}/features/{f}，TASK 的落地页同样需要
--     moduleId（功能级任务还需要 featureId）；服务端没有只凭 entityId 反推的读路由
--     （getFeature 本身要求 moduleId），因此这两列必须在写投影时一并落库；
--   * LEFTOVER 的落地页是所属记录页，故补 record_id；
--   * 三列都可空：PROJECT / MODULE / CHANGE_RECORD / TASK_GROUP / EXTERNAL_LINK 的
--     entityId 已足以推导落地页，保持 NULL；
--   * 复合外键沿用 0000 的跨层归属口径并与项目列绑定，阻止跨项目串联；
--   * 外键必须 DEFERRABLE INITIALLY DEFERRED：0031 的 app.purge_project 先删
--     tasks / features / modules / change_records、最后才删 search_projection，立即检查的
--     外键会让彻底删除中途失败（与 0001 对 notifications / activity_projection 的
--     source audit 外键处理同源）。
-- 历史迁移不得改写；本迁移只加列、加约束，并从真实来源行回填现有投影。

ALTER TABLE app.search_projection
  ADD COLUMN module_id INTEGER,
  ADD COLUMN feature_id INTEGER,
  ADD COLUMN record_id INTEGER;

-- 列与实体类型的对应关系是硬约束：只有 FEATURE / TASK 带模块归属，功能级任务（TASK）与
-- FEATURE 带功能归属，只有 LEFTOVER 带所属记录，避免写入端出现「类型与列错配」的静默脏数据。
ALTER TABLE app.search_projection
  ADD CONSTRAINT search_projection_navigation_shape_check
  CHECK (
    (module_id IS NULL OR entity_type IN ('FEATURE', 'TASK'))
    AND (feature_id IS NULL OR (entity_type IN ('FEATURE', 'TASK') AND module_id IS NOT NULL))
    AND (record_id IS NULL OR entity_type = 'LEFTOVER')
  );

ALTER TABLE app.search_projection
  ADD CONSTRAINT search_projection_module_project_fk
  FOREIGN KEY (module_id, project_id)
  REFERENCES app.modules (id, project_id)
  ON DELETE no action ON UPDATE no action
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE app.search_projection
  ADD CONSTRAINT search_projection_feature_project_fk
  FOREIGN KEY (feature_id, module_id, project_id)
  REFERENCES app.features (id, module_id, project_id)
  ON DELETE no action ON UPDATE no action
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE app.search_projection
  ADD CONSTRAINT search_projection_record_project_fk
  FOREIGN KEY (record_id, project_id)
  REFERENCES app.change_records (id, project_id)
  ON DELETE no action ON UPDATE no action
  DEFERRABLE INITIALLY DEFERRED;

-- 回填只从真实来源行推导（同项目一一对应）；推导不出来的保持 NULL，不猜测、不跨项目取值。
UPDATE app.search_projection AS projection
   SET module_id = task.module_id,
       feature_id = task.feature_id
  FROM app.tasks AS task
 WHERE projection.entity_type = 'TASK'
   AND task.id = projection.entity_id
   AND task.project_id = projection.project_id;

UPDATE app.search_projection AS projection
   SET module_id = feature.module_id,
       feature_id = feature.id
  FROM app.features AS feature
 WHERE projection.entity_type = 'FEATURE'
   AND feature.id = projection.entity_id
   AND feature.project_id = projection.project_id;

UPDATE app.search_projection AS projection
   SET record_id = leftover.record_id
  FROM app.change_record_leftover_items AS leftover
 WHERE projection.entity_type = 'LEFTOVER'
   AND leftover.id = projection.entity_id
   AND leftover.project_id = projection.project_id;

-- 延迟外键事件必须在迁移事务内清空，否则回填结果要等到 COMMIT 才校验。
SET CONSTRAINTS ALL IMMEDIATE;

DO $$
DECLARE
  drifted_tasks INTEGER;
  drifted_features INTEGER;
  drifted_leftovers INTEGER;
  undefended INTEGER;
BEGIN
  SELECT count(*) INTO drifted_tasks
    FROM app.search_projection AS projection
    JOIN app.tasks AS task
      ON task.id = projection.entity_id
     AND task.project_id = projection.project_id
   WHERE projection.entity_type = 'TASK'
     AND (projection.module_id IS DISTINCT FROM task.module_id
          OR projection.feature_id IS DISTINCT FROM task.feature_id);

  SELECT count(*) INTO drifted_features
    FROM app.search_projection AS projection
    JOIN app.features AS feature
      ON feature.id = projection.entity_id
     AND feature.project_id = projection.project_id
   WHERE projection.entity_type = 'FEATURE'
     AND (projection.module_id IS DISTINCT FROM feature.module_id
          OR projection.feature_id IS DISTINCT FROM feature.id);

  SELECT count(*) INTO drifted_leftovers
    FROM app.search_projection AS projection
    JOIN app.change_record_leftover_items AS leftover
      ON leftover.id = projection.entity_id
     AND leftover.project_id = projection.project_id
   WHERE projection.entity_type = 'LEFTOVER'
     AND projection.record_id IS DISTINCT FROM leftover.record_id;

  IF drifted_tasks <> 0 OR drifted_features <> 0 OR drifted_leftovers <> 0 THEN
    RAISE EXCEPTION
      'search_projection navigation backfill drifted (task=%, feature=%, leftover=%)',
      drifted_tasks, drifted_features, drifted_leftovers;
  END IF;

  SELECT count(*) INTO undefended
    FROM pg_catalog.pg_constraint
   WHERE conname IN (
           'search_projection_navigation_shape_check',
           'search_projection_module_project_fk',
           'search_projection_feature_project_fk',
           'search_projection_record_project_fk'
         )
     AND connamespace = 'app'::regnamespace
     AND (conname = 'search_projection_navigation_shape_check' OR condeferrable);

  IF undefended <> 4 THEN
    RAISE EXCEPTION 'search_projection navigation constraints missing or not deferrable';
  END IF;
END
$$;
