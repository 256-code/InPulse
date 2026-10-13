SET LOCAL ROLE app_owner;

-- ADR-070：企业微信机器人凭据的管理员在线配置（单行表）。
-- 口径：
--   1. 单行表（id = 1）：botId、AES-256-GCM 密文 Secret 与主密钥版本、
--      密钥尾 4 位提示、更新人、更新时间与 row_version；
--   2. 明文 Secret 永不入库：secret_ciphertext 为 nonce(12) || tag(16) || ciphertext，
--      AAD 固定为常量字符串 app.wecom_robot_config.secret；主密钥只来自
--      /run/secrets/wecom_robot_encryption_key（桥接侧读取同一 keyring 文件解密）；
--   3. 应用只读 / 插入 / 更新该行（配置永不删除），因此 app_runtime 没有 DELETE 授权；
--   4. 备份只读授权显式补齐（ADR-020 fail closed，不依赖 ALTER DEFAULT PRIVILEGES）。

CREATE TABLE app.wecom_robot_config (
  id SMALLINT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  secret_ciphertext BYTEA NOT NULL,
  secret_key_version INTEGER NOT NULL,
  secret_hint TEXT NOT NULL,
  updated_by INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT wecom_robot_config_singleton_check CHECK (id = 1),
  CONSTRAINT wecom_robot_config_bot_id_check
    CHECK (length(bot_id) BETWEEN 1 AND 128),
  CONSTRAINT wecom_robot_config_key_version_check
    CHECK (secret_key_version >= 1),
  CONSTRAINT wecom_robot_config_hint_check
    CHECK (length(secret_hint) BETWEEN 1 AND 16),
  CONSTRAINT wecom_robot_config_ciphertext_check
    CHECK (octet_length(secret_ciphertext) BETWEEN 29 AND 4096),
  CONSTRAINT wecom_robot_config_row_version_check CHECK (row_version >= 1),
  CONSTRAINT wecom_robot_config_updated_by_fk
    FOREIGN KEY (updated_by) REFERENCES app.users(id)
    ON DELETE restrict ON UPDATE no action
);

GRANT SELECT, INSERT, UPDATE ON app.wecom_robot_config TO app_runtime;
GRANT SELECT ON app.wecom_robot_config TO app_backup;

-- 部署校验：表、单行约束、最小授权与密钥列形状必须同时成立。
DO $$
DECLARE
  table_owner TEXT;
  singleton_constraint INTEGER;
  runtime_select BOOLEAN;
  runtime_insert BOOLEAN;
  runtime_update BOOLEAN;
  runtime_delete BOOLEAN;
  backup_select BOOLEAN;
  backup_insert BOOLEAN;
  updated_by_fk INTEGER;
BEGIN
  SELECT pg_get_userbyid(c.relowner)
    INTO table_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app'
     AND c.relname = 'wecom_robot_config'
     AND c.relkind = 'r';

  IF table_owner IS NULL THEN
    RAISE EXCEPTION 'app.wecom_robot_config was not created';
  END IF;
  IF table_owner <> 'app_owner' THEN
    RAISE EXCEPTION 'app.wecom_robot_config must be owned by app_owner, got %', table_owner;
  END IF;

  SELECT count(*)
    INTO singleton_constraint
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'app'
     AND t.relname = 'wecom_robot_config'
     AND c.conname = 'wecom_robot_config_singleton_check'
     AND c.contype = 'c';

  IF singleton_constraint <> 1 THEN
    RAISE EXCEPTION 'wecom_robot_config_singleton_check is missing';
  END IF;

  SELECT has_table_privilege('app_runtime', 'app.wecom_robot_config', 'SELECT'),
         has_table_privilege('app_runtime', 'app.wecom_robot_config', 'INSERT'),
         has_table_privilege('app_runtime', 'app.wecom_robot_config', 'UPDATE'),
         has_table_privilege('app_runtime', 'app.wecom_robot_config', 'DELETE')
    INTO runtime_select, runtime_insert, runtime_update, runtime_delete;

  IF NOT runtime_select OR NOT runtime_insert OR NOT runtime_update THEN
    RAISE EXCEPTION 'app_runtime must have SELECT / INSERT / UPDATE on app.wecom_robot_config';
  END IF;
  IF runtime_delete THEN
    RAISE EXCEPTION 'app_runtime must not DELETE app.wecom_robot_config';
  END IF;

  SELECT has_table_privilege('app_backup', 'app.wecom_robot_config', 'SELECT'),
         has_table_privilege('app_backup', 'app.wecom_robot_config', 'INSERT')
    INTO backup_select, backup_insert;

  IF NOT backup_select OR backup_insert THEN
    RAISE EXCEPTION 'app_backup must have read-only access to app.wecom_robot_config';
  END IF;

  SELECT count(*)
    INTO updated_by_fk
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'app'
     AND t.relname = 'wecom_robot_config'
     AND c.conname = 'wecom_robot_config_updated_by_fk'
     AND c.contype = 'f';

  IF updated_by_fk <> 1 THEN
    RAISE EXCEPTION 'wecom_robot_config_updated_by_fk is missing';
  END IF;
END
$$;
