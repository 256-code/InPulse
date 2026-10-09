SET LOCAL ROLE app_owner;

-- ADR-058：删除任务需要在同一事务内移除该任务的搜索投影行。
-- `app.search_projection` 是纯派生的检索缓存（PGroonga 全文索引的行载体），
-- 不是业务历史：任务本身的编号、描述、状态历史、功能影响与审计链全部保留在
-- 业务表和审计链里，「已删除的任务」没有任何需要留档的投影内容。反过来，保留
-- 一行 `source_status = 'DELETED'` 的投影会让搜索与命令面板继续命中一个点进去
-- 即 404 的任务，因此删除任务时物理移除该行的投影。
--
-- 0001_invariants_and_permissions.sql 只给 app_runtime 授了 SELECT/INSERT/UPDATE
-- （搜索投影此前只有 upsert 路径），本轮按最小授权补 DELETE。
--
-- 口径与边界：
--   1. 只授 `search_projection` 一张表；`app_runtime` 对业务表仍无 DELETE 权限，
--      「业务历史默认通过归档、作废或新版本保留」的不变量不受影响；
--   2. 结构、列与数据均未改动：`app_backup` 的表级 SELECT（0007）与备份排除清单
--      不受影响；
--   3. `0031_project_purge.sql` 的 `app.purge_project` 在 SECURITY DEFINER 函数内
--      删除投影，与本授权无关，仍按原路径工作。

GRANT DELETE ON app.search_projection TO app_runtime;
