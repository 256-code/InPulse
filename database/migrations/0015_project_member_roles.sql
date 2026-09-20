-- ADR-033：项目内角色（组长与项目管理员）。
-- 角色只存在于成员行上：成员被移除即失去角色；重新加入一律从 MEMBER 开始。
SET LOCAL ROLE app_owner;

ALTER TABLE app.project_members
  ADD COLUMN role TEXT NOT NULL DEFAULT 'MEMBER';

ALTER TABLE app.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('MEMBER', 'PROJECT_ADMIN', 'LEADER'));

-- 每个项目至多一条 ACTIVE 的组长成员行。
CREATE UNIQUE INDEX project_members_one_leader
  ON app.project_members (project_id)
  WHERE status = 'ACTIVE' AND role = 'LEADER';

-- 角色随成员状态失效：REMOVED 行不得保留任何非 MEMBER 角色，
-- 避免历史行携带复活即生效的权限。
ALTER TABLE app.project_members
  ADD CONSTRAINT project_members_removed_role_check
  CHECK (status = 'ACTIVE' OR role = 'MEMBER');

-- 存量项目：创建者的活跃成员行回填为 LEADER；创建者已不在活跃成员时
-- 该项目无组长，须由系统管理员显式任命（ADR-033 决策 3）。
UPDATE app.project_members AS pm
   SET role = 'LEADER'
  FROM app.projects AS p
 WHERE p.id = pm.project_id
   AND p.created_by = pm.user_id
   AND pm.status = 'ACTIVE';

-- 角色变更只允许改 role/status/removed_at 组合，身份列仍由既有
-- project_members_immutable_columns 触发器保护（id/project_id/user_id/joined_at 不可变）。
-- app_runtime 对 project_members 已有 SELECT/INSERT/UPDATE 授权（0001），新列随之可见，无需额外 GRANT。
