// 一次性自检：项目群绑定码兑换核心 + 真库行为（事务内完成并 ROLLBACK，无残留）。
// 用法：node smoke-project-group-redeem.mjs（自动从 DB_* / DB_PASSWORD_FILE 或 DATABASE_URL 连接）。
import { readFileSync } from "node:fs";
import pg from "pg";
import { extractBindingCode, hashBindingCode, redeemProjectGroupCode } from "./binding-code.mjs";

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

function makeCode(seed) {
  const body = (seed + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  return ("SGP" + body + "0000000000000000").slice(0, 16);
}
const codeShape = /^[0-9A-Z]{16}$/;

check("extract 整段严格码", extractBindingCode("ab12-cd34-ef56-gh78") === "AB12CD34EF56GH78");
check("extract @前缀", extractBindingCode("@内部研发项目管理系统 2C60-Z93Y-JTRQ-YASB") === "2C60Z93YJTRQYASB");
check("extract 词中码", extractBindingCode("请帮我绑定 2C60-Z93Y-JTRQ-YASB 谢谢") === "2C60Z93YJTRQYASB");
check("extract 非码", extractBindingCode("大家早上好") === null);

async function redeemExpectFailure(client, rawText, chatId, wecomUserid) {
  await client.query("SAVEPOINT smoke_sp");
  const result = await redeemProjectGroupCode(client, rawText, chatId, wecomUserid);
  await client.query("ROLLBACK TO SAVEPOINT smoke_sp");
  return result;
}

const putCodeSql =
  "INSERT INTO app.project_wecom_binding_codes AS c (project_id, code_hash, expires_at, consumed_at, consumed_by_wecom_userid, consumed_by_user_id) " +
  "VALUES ($1, $2, now() + ($3)::interval, NULL, NULL, NULL) " +
  "ON CONFLICT (project_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, " +
  "consumed_at = NULL, consumed_by_wecom_userid = NULL, consumed_by_user_id = NULL, created_at = now()";

{
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const projectRows = await client.query(
      "SELECT id, name FROM app.projects WHERE status = $1 ORDER BY id LIMIT 2",
      ["ACTIVE"],
    );
    const p1 = projectRows.rows[0];
    const p2 = projectRows.rows[1];
    if (!p1) throw new Error("没有 ACTIVE 项目可用于测试");

    const senderRow = await client.query(
      "SELECT b.user_id, b.wecom_userid FROM app.user_wecom_bindings AS b " +
        "JOIN app.users AS u ON u.id = b.user_id " +
        "WHERE b.status = $1 AND u.status = $1 ORDER BY b.user_id LIMIT 1",
      ["ACTIVE"],
    );
    let sender = senderRow.rows[0];
    if (!sender) {
      const adminRow = await client.query(
        "SELECT id FROM app.users WHERE status = $1 AND is_admin ORDER BY id LIMIT 1",
        ["ACTIVE"],
      );
      const admin = adminRow.rows[0];
      if (!admin) throw new Error("没有 ACTIVE 管理员可用于测试");
      const wecomUserid = "smoke-wecom-" + Date.now();
      await client.query(
        "INSERT INTO app.user_wecom_bindings (user_id, wecom_userid, status) VALUES ($1, $2, $3)",
        [admin.id, wecomUserid, "ACTIVE"],
      );
      sender = { user_id: admin.id, wecom_userid: wecomUserid };
    }
    console.log("测试项目:", p1.id, p1.name, "| 发送者:", sender.user_id, sender.wecom_userid);

    const suffix = Date.now();
    const chatA = "smoke-group-" + suffix + "-a";
    const chatB = "smoke-group-" + suffix + "-b";
    const chatC = "smoke-group-" + suffix + "-c";

    const code1 = makeCode("a1");
    if (!codeShape.test(code1)) throw new Error("makeCode 形态不合法: " + code1);
    await client.query(putCodeSql, [p1.id, hashBindingCode(code1), "10 minutes"]);

    const r1 = await redeemProjectGroupCode(client, "@机器人 " + code1, chatA, sender.wecom_userid);
    check("首次兑换绑定成功", r1.outcome === "bound" && r1.projectId === p1.id && r1.rebound === false,
      JSON.stringify(r1.outcome === "bound" ? { projectId: r1.projectId, projectName: r1.projectName, rebound: r1.rebound } : r1));

    const g1 = await client.query(
      "SELECT status, bound_by_user_id FROM app.project_wecom_groups WHERE wecom_chat_id = $1",
      [chatA],
    );
    check("群绑定行写入", g1.rows.length === 1 && g1.rows[0].status === "ACTIVE" && g1.rows[0].bound_by_user_id === sender.user_id,
      JSON.stringify(g1.rows));

    const r2 = await redeemExpectFailure(client, code1, chatA, sender.wecom_userid);
    check("重复兑换 -> PWG02", r2.outcome === "failed" && r2.sqlState === "PWG02",
      r2.outcome === "failed" ? r2.sqlState : r2.outcome);

    const code2 = makeCode("a2");
    await client.query(putCodeSql, [p1.id, hashBindingCode(code2), "10 minutes"]);
    const r3 = await redeemProjectGroupCode(client, code2, chatA, sender.wecom_userid);
    check("同群同项目新码 -> 幂等 rebound=false", r3.outcome === "bound" && r3.rebound === false,
      r3.outcome === "bound" ? "rebound=" + r3.rebound : r3.sqlState);

    const code3 = makeCode("a3");
    await client.query(putCodeSql, [p1.id, hashBindingCode(code3), "10 minutes"]);
    const r4 = await redeemProjectGroupCode(client, code3, chatB, sender.wecom_userid);
    check("换绑新群 -> rebound=true", r4.outcome === "bound" && r4.rebound === true,
      r4.outcome === "bound" ? "rebound=" + r4.rebound : r4.sqlState);

    const gOld = await client.query(
      "SELECT status FROM app.project_wecom_groups WHERE wecom_chat_id = $1",
      [chatA],
    );
    check("旧群行全部 REVOKED", gOld.rows.length > 0 && gOld.rows.every((row) => row.status === "REVOKED"),
      JSON.stringify(gOld.rows));

    if (p2) {
      const code4 = makeCode("b1");
      await client.query(putCodeSql, [p2.id, hashBindingCode(code4), "10 minutes"]);
      const r5 = await redeemExpectFailure(client, code4, chatB, sender.wecom_userid);
      check("群已绑其他项目 -> PWG05", r5.outcome === "failed" && r5.sqlState === "PWG05",
        r5.outcome === "failed" ? r5.sqlState : r5.outcome);

      const code5 = makeCode("b2");
      await client.query(
        "INSERT INTO app.project_wecom_binding_codes AS c (project_id, code_hash, expires_at, created_at) " +
          "VALUES ($1, $2, now() - ($3)::interval, now() - ($4)::interval) " +
          "ON CONFLICT (project_id) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, " +
          "created_at = EXCLUDED.created_at, consumed_at = NULL, consumed_by_wecom_userid = NULL, consumed_by_user_id = NULL",
        [p2.id, hashBindingCode(code5), "1 minute", "5 minutes"],
      );
      const r6 = await redeemExpectFailure(client, code5, chatC, sender.wecom_userid);
      check("过期码 -> PWG06", r6.outcome === "failed" && r6.sqlState === "PWG06",
        r6.outcome === "failed" ? r6.sqlState : r6.outcome);
    } else {
      console.log("SKIP 群已绑其他项目 / 过期码：需要至少 2 个 ACTIVE 项目");
    }

    const code6 = makeCode("a4");
    await client.query(putCodeSql, [p1.id, hashBindingCode(code6), "10 minutes"]);
    const r7 = await redeemExpectFailure(client, code6, chatC, "smoke-wecom-unbound-" + suffix);
    check("未绑定发送者 -> PWG03", r7.outcome === "failed" && r7.sqlState === "PWG03",
      r7.outcome === "failed" ? r7.sqlState : r7.outcome);

    const r8 = await redeemExpectFailure(client, "ZZZZ-ZZZZ-ZZZZ-ZZZZ", chatC, sender.wecom_userid);
    check("未注册码 -> PWG01", r8.outcome === "failed" && r8.sqlState === "PWG01",
      r8.outcome === "failed" ? r8.sqlState : r8.outcome);

    const nonMemberRow = await client.query(
      "SELECT u.id AS user_id, p.id AS project_id FROM app.users AS u CROSS JOIN app.projects AS p " +
        "WHERE u.status = $1 AND u.is_admin = false AND p.status = $1 " +
        "AND NOT EXISTS (SELECT 1 FROM app.user_wecom_bindings AS b WHERE b.user_id = u.id AND b.status = $1) " +
        "AND NOT EXISTS (SELECT 1 FROM app.project_members AS m WHERE m.project_id = p.id AND m.user_id = u.id AND m.status = $1) " +
        "ORDER BY u.id, p.id LIMIT 1",
      ["ACTIVE"],
    );
    const pair = nonMemberRow.rows[0];
    if (pair) {
      const wecomUserid = "smoke-wecom-nonmember-" + suffix;
      await client.query(
        "INSERT INTO app.user_wecom_bindings (user_id, wecom_userid, status) VALUES ($1, $2, $3)",
        [pair.user_id, wecomUserid, "ACTIVE"],
      );
      const code7 = makeCode("c1");
      await client.query(putCodeSql, [pair.project_id, hashBindingCode(code7), "10 minutes"]);
      const r9 = await redeemExpectFailure(client, code7, chatC, wecomUserid);
      check("非成员发送者 -> PWG04", r9.outcome === "failed" && r9.sqlState === "PWG04",
        r9.outcome === "failed" ? r9.sqlState : r9.outcome);
    } else {
      console.log("SKIP 非成员 -> PWG04：没有非管理员且未绑定的组合");
    }
  } catch (error) {
    failures += 1;
    console.log("FAIL 事务内执行异常 |", error && error.message ? error.message : String(error));
  } finally {
    try { await client.query("ROLLBACK"); } catch {}
    client.release();
  }
}

await pool.end();
console.log(failures === 0 ? "ALL PASS" : failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
