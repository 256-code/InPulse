SET LOCAL ROLE app_owner;

-- B-3b 跨项目记录读索引（开发工作书 2026-09-12「B-3b 独立契约纵切片」定案）。
--
-- `/records` 打开「全部项目」后，两类读路径都不再以 project_id 为前导列：
--   1. 跨项目记录清单 listRecordFeed：status 等值（PUBLISHED / VOID）+ 服务端
--      AuthorizedProjectScope 的 project_id = ANY(...) 过滤，固定按
--      published_at DESC, id DESC 做 keyset 分页；
--   2. 我的草稿 listMyRecordDrafts：author_id = actor AND status = 'DRAFT'，
--      固定按 created_at DESC, id DESC 做 keyset 分页。
-- 既有 change_records_project_status_idx 以 project_id 为前导列，跨项目查询
-- 只能全表扫描后再排序。本迁移只新增两个只读查询索引，不改变任何列、约束、
-- 状态机与可见性规则（status 仍是可见性唯一真相；VOID 行的 ADMIN_ONLY 收敛
-- 在应用层，见 record-lifecycle.service.ts）。
--
-- ⚠ 人工复核项：索引列序必须与分页排序保持一致，接口改排序即须同步本索引；
-- 若真实容量下 EXPLAIN 显示新索引未被选中，按 A-5 的容量门禁另行裁决。
CREATE INDEX "change_records_status_published_idx"
  ON "app"."change_records" USING btree ("status", "published_at" DESC, "id" DESC);

CREATE INDEX "change_records_author_status_created_idx"
  ON "app"."change_records" USING btree ("author_id", "status", "created_at" DESC, "id" DESC);