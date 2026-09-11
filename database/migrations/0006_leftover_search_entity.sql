SET LOCAL ROLE app_owner;

-- F-26（功能设计 §24.1 / §24.2）：搜索投影新增「遗留问题」实体类型。
-- 应用层白名单为 SEARCH_PROJECTION_ENTITY_TYPES，数据库约束是最终防线；
-- 本迁移只扩展只读搜索投影的枚举，不涉及任何写路由或幂等契约。
ALTER TABLE app.search_projection
  DROP CONSTRAINT "search_projection_entity_type_check";

ALTER TABLE app.search_projection
  ADD CONSTRAINT "search_projection_entity_type_check"
  CHECK (entity_type IN ('PROJECT', 'MODULE', 'FEATURE', 'TASK', 'CHANGE_RECORD', 'EXTERNAL_LINK', 'TASK_GROUP', 'LEFTOVER'));