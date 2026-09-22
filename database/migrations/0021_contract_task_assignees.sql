SET LOCAL ROLE app_owner;

-- ADR-040 contract 段：负责人集合真相已由 0020_task_assignees.sql 建立并回填，
-- 这里删除旧单列与旧索引，结束「同一事实两个来源」的过渡窗口。
-- 回滚边界：0020 之后旧代码仍可读 tasks.assignee_id（列尚在），0021 之后旧代码
-- 不可读，但集合数据完整，因此回滚需连同镜像一起回到新版本。

DROP INDEX app.tasks_assignee_status_idx;
ALTER TABLE app.tasks DROP COLUMN assignee_id;
