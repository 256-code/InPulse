SET LOCAL ROLE app_owner;

-- ADR-040：任务负责人由单列 tasks.assignee_id 改为多负责人集合，语义完全平权
-- （任一被指派人都能推进状态、都进「我的任务」、都收通知）。
-- app.task_assignees 是负责人集合的唯一真相；本迁移是 expand 段（建表 + 回填 +
-- 防线重定向），旧列与旧索引的删除放在 0021_contract_task_assignees.sql。

CREATE TABLE app.task_assignees (
  task_id integer NOT NULL,
  user_id integer NOT NULL,
  project_id integer NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_assignees_pkey PRIMARY KEY (task_id, user_id),
  -- 复合外键把归属钉在任务所属项目上，阻止负责人行与任务跨项目串联。
  CONSTRAINT task_assignees_task_project_fk
    FOREIGN KEY (task_id, project_id)
    REFERENCES app.tasks (id, project_id),
  CONSTRAINT task_assignees_user_id_fk
    FOREIGN KEY (user_id) REFERENCES app.users (id)
);

-- 升级窗口：迁移前每个任务恰好一名负责人，按原值回填后读路径语义不变。
INSERT INTO app.task_assignees (task_id, user_id, project_id)
SELECT t.id, t.assignee_id, t.project_id FROM app.tasks AS t;

-- 「负责人必须是项目活跃成员」防线跟随真相表迁移（0001 先例，函数名保持不变，
-- 只把判定的列从 NEW.assignee_id 换成 NEW.user_id）。
DROP TRIGGER tasks_active_assignee ON app.tasks;
DROP FUNCTION app.require_active_task_assignee();

CREATE FUNCTION app.require_active_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  PERFORM 1
    FROM app.users AS u
   WHERE u.id = NEW.user_id
     AND u.status = 'ACTIVE'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task assignee % is not an active user', NEW.user_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  PERFORM 1
    FROM app.project_members AS pm
   WHERE pm.project_id = NEW.project_id
     AND pm.user_id = NEW.user_id
     AND pm.status = 'ACTIVE'
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'task assignee % is not an active member of project %',
      NEW.user_id, NEW.project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION app.require_active_task_assignee() FROM PUBLIC;

CREATE TRIGGER task_assignees_active_assignee
BEFORE INSERT OR UPDATE OF project_id, user_id ON app.task_assignees
FOR EACH ROW EXECUTE FUNCTION app.require_active_task_assignee();

-- 负责人行不可改写：改派以「先删后插」实现，因此 app_runtime 不持有 UPDATE。
CREATE TRIGGER task_assignees_immutable_columns
BEFORE UPDATE ON app.task_assignees
FOR EACH ROW EXECUTE FUNCTION app.reject_immutable_column_changes(
  'task_id', 'user_id', 'project_id', 'created_at'
);

-- 「我的任务」按当前用户筛选的主索引。
CREATE INDEX task_assignees_user_idx ON app.task_assignees (user_id, task_id);

GRANT SELECT, INSERT, DELETE ON app.task_assignees TO app_runtime;
-- 新表显式补备份只读授权（ADR-020 fail closed：不依赖 ALTER DEFAULT PRIVILEGES）。
GRANT SELECT ON app.task_assignees TO app_backup;
