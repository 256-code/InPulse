SET LOCAL ROLE app_owner;

-- ADR-048：每个项目只要还有活跃成员，就必须恰好保留一名活跃组长（LEADER）。
-- 背景：ADR-033 只保证「至多一名组长」（project_members_one_leader 部分唯一索引），
-- 服务端又允许把唯一组长撤销为 MEMBER，于是项目可以变成「有成员但没有组长」；
-- 同时没有任何规则保证「最后一名成员不可被移除」，项目可以变成零成员。
-- 本迁移把「至少一名组长」变成数据库最终防线，并回填存量无组长项目。
--
-- 口径（与 ADR-048 一致）：
--   1. 活跃成员数 = 0 的项目保持合法：夹具清理与历史遗留会产生零成员项目，
--      零成员 ⇒ 没有「当前成员」，也就不存在「当前组长」；
--   2. 活跃成员数 ≥ 1 时必须恰好一名 ACTIVE LEADER；
--      至多一名由 project_members_one_leader 保证，本触发器只补「至少一名」；
--   3. 「最后一名成员不可移除」是服务端命令语义（保证项目至少有一名成员），
--      不在数据库层禁止零成员，否则夹具清理与历史迁移都会失败。
--
-- 顺序不可颠倒：先回填存量数据，结算延迟约束事件，再创建触发器与函数；
-- 最后用 DO 块自校验回填结果，回填失败即整个迁移回滚。
-- 本迁移只改数据与新增函数/触发器，不改列定义，不递增 row_version（该表没有
-- row_version 触发器），不写审计（属数据迁移）。

-- 1) 回填：对「有活跃成员但没有活跃组长」的项目，优先任命仍然在任的创建者，
--    否则按最早加入（joined_at、id 升序）任命最早的那名活跃成员。
--    这与创建项目时「创建者自动成为组长」同一口径，保证升级后行为可预期。
--    回填只解决历史数据：运行期不存在「组长自动继任」，组长只能通过转移更换
--    （ADR-048 方案 A），移除组长本身被 409 拒绝。
WITH leaderless AS (
  SELECT pm.id AS membership_id,
         row_number() OVER (
           PARTITION BY pm.project_id
           ORDER BY (p.created_by = pm.user_id) DESC, pm.joined_at, pm.id
         ) AS leader_rank
    FROM app.project_members AS pm
    JOIN app.projects AS p ON p.id = pm.project_id
   WHERE pm.status = 'ACTIVE'
     AND NOT EXISTS (
       SELECT 1
         FROM app.project_members AS existing
        WHERE existing.project_id = pm.project_id
          AND existing.status = 'ACTIVE'
          AND existing.role = 'LEADER'
     )
)
UPDATE app.project_members AS target
   SET role = 'LEADER'
  FROM leaderless
 WHERE leaderless.membership_id = target.id
   AND leaderless.leader_rank = 1;

-- 2) 回填会挂起 project_members 上的延迟约束事件（bootstrap 完整性），
--    必须先结算才能继续在该表上创建触发器。
SET CONSTRAINTS ALL IMMEDIATE;

-- 3) 断言函数：镜像 app.assert_project_bootstrap 的写法——项目行不存在就直接返回
--    （删除项目/夹具清理时的级联删除不应被本不变量拦截），否则统计活跃成员与组长。
CREATE FUNCTION app.assert_project_leader(project_key INTEGER)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
DECLARE
  active_members INTEGER;
  active_leaders INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.projects WHERE id = project_key) THEN
    RETURN;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE role = 'LEADER')
    INTO active_members, active_leaders
    FROM app.project_members
   WHERE project_id = project_key
     AND status = 'ACTIVE';

  IF active_members = 0 THEN
    RETURN;
  END IF;

  IF active_leaders <> 1 THEN
    RAISE EXCEPTION
      'project % has % active members but % active leader',
      project_key, active_members, active_leaders
      USING ERRCODE = 'check_violation';
  END IF;
END
$function$;

CREATE FUNCTION app.check_project_leader_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app.assert_project_leader(OLD.project_id);
  ELSE
    PERFORM app.assert_project_leader(NEW.project_id);
    IF TG_OP = 'UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
      PERFORM app.assert_project_leader(OLD.project_id);
    END IF;
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER project_members_leader_complete
AFTER INSERT OR UPDATE OR DELETE ON app.project_members
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION app.check_project_leader_trigger();

-- 4) 自校验：回填后不允许存在「有活跃成员但没有恰好一名活跃组长」的项目。
DO $check$
DECLARE
  broken_count INTEGER;
BEGIN
  SELECT count(*)
    INTO broken_count
    FROM app.projects AS p
   WHERE EXISTS (
           SELECT 1
             FROM app.project_members AS pm
            WHERE pm.project_id = p.id
              AND pm.status = 'ACTIVE'
         )
     AND (
           SELECT count(*)
             FROM app.project_members AS pm
            WHERE pm.project_id = p.id
              AND pm.status = 'ACTIVE'
              AND pm.role = 'LEADER'
         ) <> 1;
  IF broken_count <> 0 THEN
    RAISE EXCEPTION
      'migration 0026 left % project(s) without exactly one leader',
      broken_count
      USING ERRCODE = 'check_violation';
  END IF;
END
$check$;

-- app_runtime 对 project_members 已有 SELECT/INSERT/UPDATE/DELETE 授权，触发器函数
-- 与既有 app.assert_project_bootstrap 一样是 SECURITY DEFINER 且保留默认 PUBLIC
-- EXECUTE，无需额外 GRANT。
