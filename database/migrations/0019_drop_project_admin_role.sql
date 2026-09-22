SET LOCAL ROLE app_owner;

-- ADR-039：移除项目管理员（PROJECT_ADMIN）角色，项目内管理权限下放给全体活跃成员。
-- 组长（LEADER）身份不变量保留：每项目至多一条 ACTIVE 组长行、REMOVED 行只能为 MEMBER。
-- 本迁移只改数据与 CHECK 约束，不改列定义、不递增 row_version、不写审计（属数据迁移）。
--
-- 顺序不可颠倒：必须先把存量 PROJECT_ADMIN 降级为 MEMBER，再收紧 CHECK，
-- 否则 ADD CONSTRAINT 会因表内仍存在 PROJECT_ADMIN 行而校验失败。

UPDATE app.project_members
   SET role = 'MEMBER'
 WHERE role = 'PROJECT_ADMIN';

-- 上面的降级会挂起 project_members_bootstrap_complete 延迟约束触发器事件：
-- 未结算的同一张表不允许 ALTER TABLE（55006 pending trigger events）。
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.project_members
  DROP CONSTRAINT project_members_role_check;

ALTER TABLE app.project_members
  ADD CONSTRAINT project_members_role_check
  CHECK (role IN ('MEMBER', 'LEADER'));
