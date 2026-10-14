SET LOCAL ROLE app_owner;

-- 0043：企业微信机器人资料链接（botProfileUrl，ADR-070 扩展）。
-- 口径：
--   1. 管理员在「成员与设置 → 企业微信机器人」填写机器人资料页链接
--      （https://work.weixin.qq.com/...），供成员「绑定企业微信」弹窗展示，
--      指引其在企业微信中打开机器人；非敏感展示字段，可空；
--   2. 只接受 https:// 前缀、长度 1–512；契约与服务端同口径校验；
--   3. 加列不破坏升级 / 回滚兼容窗口（可空、无默认值，旧代码可继续读写既有列）。

ALTER TABLE app.wecom_robot_config
  ADD COLUMN bot_profile_url TEXT NULL;

ALTER TABLE app.wecom_robot_config
  ADD CONSTRAINT wecom_robot_config_profile_url_check
  CHECK (
    bot_profile_url IS NULL
    OR (
      length(bot_profile_url) BETWEEN 1 AND 512
      AND bot_profile_url ~ '^https://'
    )
  );

-- 部署校验：列与约束必须同时成立。
DO $$
DECLARE
  column_count INTEGER;
  constraint_count INTEGER;
BEGIN
  SELECT count(*)
    INTO column_count
    FROM information_schema.columns
   WHERE table_schema = 'app'
     AND table_name = 'wecom_robot_config'
     AND column_name = 'bot_profile_url'
     AND is_nullable = 'YES';

  IF column_count <> 1 THEN
    RAISE EXCEPTION 'app.wecom_robot_config.bot_profile_url was not created';
  END IF;

  SELECT count(*)
    INTO constraint_count
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'app'
     AND t.relname = 'wecom_robot_config'
     AND c.conname = 'wecom_robot_config_profile_url_check'
     AND c.contype = 'c';

  IF constraint_count <> 1 THEN
    RAISE EXCEPTION 'wecom_robot_config_profile_url_check is missing';
  END IF;
END
$$;
