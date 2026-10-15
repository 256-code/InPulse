import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

function buildDatabaseUrl() {
  const direct = process.env.DATABASE_URL;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }
  const host = process.env.DB_HOST || "db";
  const port = process.env.DB_PORT || "5432";
  const name = process.env.DB_NAME || "app";
  const user = process.env.DB_USER || "app_runtime";
  const passwordFile = process.env.DB_PASSWORD_FILE || "/run/secrets/db_runtime_password";
  const password = readFileSync(passwordFile, "utf8").trim();
  const sslmode = (process.env.DB_SSLMODE || "").trim();
  const base = "postgresql://" + encodeURIComponent(user) + ":" + encodeURIComponent(password) + "@" + host + ":" + port + "/" + name;
  return sslmode.length > 0 ? base + "?sslmode=" + sslmode : base;
}

const pool = new Pool({ connectionString: buildDatabaseUrl(), max: 1 });
const info = await pool.query("select current_user as u, current_database() as d");
console.log("DB-OK", JSON.stringify(info.rows[0]));
const n = await pool.query("select count(*)::int as c, max(id)::bigint as m from app.notifications");
console.log("NOTIF", JSON.stringify(n.rows[0]));
const w = await pool.query("select id, bot_id, secret_key_version, secret_hint from app.wecom_robot_config");
console.log("WECOM", JSON.stringify(w.rows[0]));
const q = "select n.id, n.recipient_id, t.id as task_id, p.id as project_id from app.notifications n left join app.tasks t on t.id = nullif(substring(n.target_path from \u0027taskId=([0-9]+)\u0027), \u0027\u0027)::int left join app.projects p on p.id = n.project_id where n.id > $1 order by n.id asc limit 3";
const r = await pool.query(q, [22000]);
console.log("POLLQ rows=" + r.rows.length);
await pool.end();
console.log("SMOKE-DB-OK");
