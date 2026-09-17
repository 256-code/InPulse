SET LOCAL ROLE app_owner;

-- F-06.3 项目生命周期四态（ADR-035）：未开始 / 进行中 / 维护中 / 已归档。
-- 改造前项目存储状态只有 ACTIVE/ARCHIVED 两态，「未开始 / 正常」是前端按
-- 「作用域内有没有已完成任务」推导出来的标签；改造后标签直接读存储状态，
-- 因此需要把推导结果回填成真实状态，并新增永不回落的 first_task_completed_at
-- 粘性标记，作为「项目已有产出则不可回退未开始」的判定依据。
--
-- 存量迁移规则：
--   1. 项目内出现过已完成任务（task_status_history.to_work_status = DONE）→ 进行中；
--   2. 其余原 ACTIVE 项目 → 未开始，与改造前的展示标签完全一致；
--   3. 已归档项目状态不变，只补齐 first_task_completed_at，恢复时一律回到进行中。
-- 迁移不递增 row_version、不写审计，属于数据迁移而非用户动作。

ALTER TABLE app.projects
  DROP CONSTRAINT projects_status_check;

ALTER TABLE app.projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('NOT_STARTED', 'ACTIVE', 'MAINTENANCE', 'ARCHIVED'));

-- 新项目从未开始起步，首次有任务完成时自动升级为进行中。
ALTER TABLE app.projects
  ALTER COLUMN status SET DEFAULT 'NOT_STARTED';

-- 归档约束改写：四态里只有 ARCHIVED 允许 archived_at 非空，其余三态都必须为空。
ALTER TABLE app.projects
  DROP CONSTRAINT projects_archive_state_check;

ALTER TABLE app.projects
  ADD CONSTRAINT projects_archive_state_check
  CHECK (
    (status <> 'ARCHIVED' AND archived_at IS NULL)
    OR (status = 'ARCHIVED' AND archived_at IS NOT NULL)
  );

-- 粘性标记：第一次有任务完成时置位，永不回落。
ALTER TABLE app.projects
  ADD COLUMN first_task_completed_at TIMESTAMPTZ;

-- 回填是数据迁移，不递增 row_version（见 ADR-035），但 app.projects 的
-- projects_row_version 触发器要求每次 UPDATE 恰好 +1，因此回填期间临时关闭该触发器，
-- 结束后立即恢复。整个迁移在一个事务内执行，失败回滚不会留下被关闭的触发器。
ALTER TABLE app.projects DISABLE TRIGGER projects_row_version;

-- 回填：任务状态历史保留每次完成快照，因此能精确还原项目第一次有产出的时刻。
UPDATE app.projects p
   SET first_task_completed_at = completed.first_completed_at
  FROM (
    SELECT t.project_id,
           MIN(h.completed_at_snapshot) AS first_completed_at
      FROM app.task_status_history h
      JOIN app.tasks t
        ON t.id = h.task_id
       AND t.project_id = h.project_id
     WHERE h.to_work_status = 'DONE'
       AND h.completed_at_snapshot IS NOT NULL
     GROUP BY t.project_id
  ) AS completed
 WHERE p.id = completed.project_id
   AND p.first_task_completed_at IS NULL;

-- 其余活跃项目统一落到未开始，保持改造前的展示标签不变。
UPDATE app.projects
   SET status = 'NOT_STARTED'
 WHERE status = 'ACTIVE'
   AND first_task_completed_at IS NULL;


-- 上面的回填会挂起延迟约束触发器事件，必须先结算才能再对同一张表执行 ALTER TABLE。
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE app.projects ENABLE TRIGGER projects_row_version;

-- 硬约束兜底：既有产出又处于未开始的行不允许存在；服务端仍独立校验并返回 409。
ALTER TABLE app.projects
  ADD CONSTRAINT projects_not_started_lock_check
  CHECK (status <> 'NOT_STARTED' OR first_task_completed_at IS NULL);
