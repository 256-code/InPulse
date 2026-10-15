// 一次性自检：绑定码兑换核心 + 真库行为（事务内部分结束 ROLLBACK 无残留）。
// 用法：node smoke-redeem.mjs（自动从 DB_* / DB_PASSWORD_FILE 或 DATABASE_URL 连接）。
import { readFileSync } from "node:fs";
import pg from "pg";
import { hashBindingCode, normalizeBindingCode, redeemBindingCode } from "./binding-code.mjs";

function buildDatabaseUrl() {
  const direct = process.env.DATABASE_URL;
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  const password = readFileSync(process.env.DB_PASSWORD_FILE || "/run/secrets/db_runtime_password", "utf8").trim();
  const base = "postgresql://" +
    encodeURIComponent(process.env.DB_USER || "app_runtime") + ":" + encodeURIComponent(password) +
    "@" + (process.env.DB_HOST || "db") + ":" + (process.env.DB_PORT || "5432") + "/" + (process.env.DB_NAME || "app");
  const sslmode = (process.env.DB_SSLMODE || "").trim();
  return sslmode.length > 0 ? base + "?sslmode=" + sslmode : base;
}

const pool = new pg.Pool({ connectionString: buildDatabaseUrl(), max: 1 });
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " | " + detail : ""));
  if (!ok) failures += 1;
}

check("normalize 连字符", normalizeBindingCode("ab12-cd34-ef56-gh78") === "AB12CD34EF56GH78");
check("normalize 空格", normalizeBindingCode(" AB12 CD34 EF56 GH78 ") === "AB12CD34EF56GH78");
check("normalize 全角连字符", normalizeBindingCode("AB12－CD34－EF56－GH78") === "AB12CD34EF56GH78");
check("normalize 非码文本", normalizeBindingCode("你好，请帮我绑定一下") === null);

// 事务内：插入测试码 -> 成功兑换 -> 校验绑定行 -> 重复兑换（WBC02）-> ROLLBACK。
{
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const userRow = await client.query("SELECT id, name FROM app.users WHERE status = 'ACTIVE' ORDER BY id LIMIT 1");
    const testUser = userRow.rows[0];
    if (!testUser) throw new Error("没有 ACTIVE 用户可用于测试");
    console.log("测试用户:", testUser.id, testUser.name);

    const rawCode = "ABCD-EFGH-JKMN-PQRS";
    const codeHash = hashBindingCode(rawCode);
    await client.query(
      "INSERT INTO app.wecom_binding_codes AS c (user_id, code_hash, expires_at, consumed_at, consumed_by_wecom_userid) VALUES ($1, $2, now() + interval '10 minutes', NULL, NULL) ON CONFLICT (user_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, consumed_at = NULL, consumed_by_wecom_userid = NULL, created_at = now()",
      [testUser.id, codeHash],
    );

    const r1 = await redeemBindingCode(client, "abcd-efgh-jkmn-pqrs", "smoke-userid-1");
    check("成功兑换（小写输入）", r1.outcome === "bound" && r1.userId === testUser.id, JSON.stringify(r1.outcome === "bound" ? { userId: r1.userId, displayName: r1.displayName } : r1));

    const bound = await client.query(
      "SELECT wecom_userid, status FROM app.user_wecom_bindings WHERE user_id = $1 AND status = 'ACTIVE'",
      [testUser.id],
    );
    check("绑定行写入", bound.rows.length === 1 && bound.rows[0].wecom_userid === "smoke-userid-1", JSON.stringify(bound.rows));

    const r2 = await redeemBindingCode(client, rawCode, "smoke-userid-1");
    check("重复兑换 -> WBC02", r2.outcome === "failed" && r2.sqlState === "WBC02", r2.outcome === "failed" ? r2.sqlState : r2.outcome);
  } catch (error) {
    failures += 1;
    console.log("FAIL 事务内执行异常 |", error && error.message ? error.message : String(error));
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    client.release();
  }
}

// 事务外：未注册码（失败调用无写入）与非码文本。
{
  const r3 = await redeemBindingCode(pool, "AAAA-BBBB-CCCC-DDDD", "smoke-userid-2");
  check("未注册码 -> WBC01", r3.outcome === "failed" && r3.sqlState === "WBC01", r3.outcome === "failed" ? r3.sqlState : r3.outcome);
}
{
  const r4 = await redeemBindingCode(pool, "随便说点什么", "smoke-userid-2");
  check("非码文本 -> not-a-code", r4.outcome === "not-a-code");
}

await pool.end();
console.log(failures === 0 ? "ALL PASS" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
