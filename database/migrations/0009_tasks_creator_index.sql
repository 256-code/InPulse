SET LOCAL ROLE app_owner;

-- R-3「我创建的」归属维度索引（F-32 任务中心 ownership=CREATOR）。
--
-- R-3 listMyTasks 新增 ownership 归属维度后，CREATOR 分支按
-- `creator_id = actor` + AuthorizedProjectScope 的 project_id = ANY(...) 过滤，
-- 固定按 id DESC 做 keyset 分页（契约仍不接受 sort 参数，Q-10）。
-- 既有 tasks_project_status_idx 以 project_id 为前导列，在「跨项目 / 我创建的」
-- 形状下只能逐项目扫描后在内存过滤 creator_id；tasks_assignee_status_idx 只覆盖
-- assignee_id，无法服务该列。本迁移只新增一个只读查询索引，不改变任何列、约束、
-- 状态机、可见性规则与授权范围：ownership 的两个取值都只是当前 Session 用户的自指
-- 维度（Q-08 不扩张授权范围），仍由 AuthorizedProjectScope 在 SQL 层过滤。
--
-- ⚠ 人工复核项：索引列序必须与分页排序（id DESC）保持一致，接口改排序即须同步本索引；
-- 若真实容量下 EXPLAIN 显示新索引未被选中，按 A-5 的容量门禁另行裁决。
CREATE INDEX "tasks_creator_status_idx"
  ON "app"."tasks" USING btree ("creator_id", "work_status", "id");
