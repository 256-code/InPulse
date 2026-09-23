SET LOCAL ROLE app_owner;

-- ADR-041：删除任务优先级「低」（LOW）档位，优先级由四档收窄为三档 NORMAL / HIGH / URGENT。
-- 本迁移只改数据与 CHECK 约束，不改列定义、不写审计（属数据迁移）。
--
-- 顺序不可颠倒：必须先把存量 LOW 归一到默认档 NORMAL，再收紧 CHECK，
-- 否则 ADD CONSTRAINT 会因表内仍存在 LOW 行而校验失败。
-- 归一是降级而不是删除：任务本体、状态历史、审计、投影与聚合关系都原样保留；
-- app.tasks 的行版本触发器要求 row_version 恰好递增一次，因此这里显式 +1，
-- 让持有旧 row_version 的客户端在编辑时按乐观锁拿到 409。

UPDATE app.tasks
   SET priority = 'NORMAL',
       row_version = row_version + 1
 WHERE priority = 'LOW';

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.tasks
  DROP CONSTRAINT tasks_priority_check;

ALTER TABLE app.tasks
  ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('NORMAL', 'HIGH', 'URGENT'));
