// API 生产镜像内置存活探针（技术设计 v1.2.2 §11.3）。
// health/live 不访问数据库，只确认进程事件循环正常。
const port = process.env["PORT"]?.trim() || "3000";
const url = `http://127.0.0.1:${port}/api/v1/health/live`;

let response;
try {
  response = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });
} catch {
  process.exit(1);
}

if (!response.ok) {
  process.exit(1);
}

let body;
try {
  body = await response.json();
} catch {
  process.exit(1);
}

if (body?.status !== "ok") {
  process.exit(1);
}

process.exit(0);
