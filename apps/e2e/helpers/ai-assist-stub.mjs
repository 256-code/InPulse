import { createServer } from "node:http";

/**
 * ADR-067 E2E 用的 OpenAI 兼容 stub 上游（只监听本机回环，CI 不访问外网）。
 *
 * 从请求 text 里提取「负责人」与「AIE2E-」唯一标记，生成一份可被固定模板解析器
 * 接受的合法草稿：标记每次运行都不同，保证文档摘要不同、不会触发
 * 「同一文档已导入过」的 409；负责人必须是真实存在的 E2E 用户，由夹具写入。
 */
const port = Number.parseInt(process.env.E2E_AI_STUB_PORT ?? "3199", 10);
const model = process.env.E2E_AI_STUB_MODEL ?? "e2e-stub-model";

function extractOwner(text) {
  const labeled = /负责人[:：]\s*([A-Za-z0-9_-]+)/.exec(text);
  if (labeled) return labeled[1];
  const ascii = /owner\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text);
  return ascii ? ascii[1] : "e2e_owner";
}

function extractMarker(text) {
  const marker = /AIE2E-[A-Z0-9]+/.exec(text);
  return marker ? marker[0] : "AIE2E-FALLBACK";
}

function buildContent(mode, text) {
  const owner = extractOwner(text);
  const marker = extractMarker(text);
  const lines = [];
  if (mode === "WHOLE_PROJECT") {
    lines.push("# 项目：AI 导入项目 " + marker);
    lines.push("- 项目编码：AIP" + marker.slice(6, 14));
    lines.push("");
  }
  lines.push("## 模块：AI 导入模块 " + marker);
  lines.push("- 说明：E2E stub 生成的模块。");
  lines.push("");
  lines.push("### 功能：AI 导入功能");
  lines.push("- 当前说明：E2E stub 生成的功能。");
  lines.push("");
  lines.push("#### 任务：AI 导入任务");
  lines.push("- 负责人：" + owner);
  return lines.join("\n");
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method !== "POST") {
    response.writeHead(405, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "method not allowed" }));
    return;
  }
  let raw = "";
  request.on("data", (chunk) => {
    raw += chunk;
  });
  request.on("end", () => {
    // API 按 OpenAI chat/completions 形状发送 messages：system 是规则（含模式），
    // user 才是抽取出来的用户原文；模式从 system 的模式约束里判定。
    let mode = "IN_PROJECT";
    let text = "";
    try {
      const body = JSON.parse(raw);
      const messages =
        body && Array.isArray(body.messages) ? body.messages : [];
      const userMessage = messages.find(
        (message) => message && message.role === "user",
      );
      if (userMessage && typeof userMessage.content === "string") {
        text = userMessage.content;
      }
      const systemMessage = messages.find(
        (message) => message && message.role === "system",
      );
      if (
        systemMessage &&
        typeof systemMessage.content === "string" &&
        systemMessage.content.includes("当前模式：整项目导入")
      ) {
        mode = "WHOLE_PROJECT";
      }
    } catch {
      // 故意保持宽松：stub 只需要 user message 里的标记行。
    }
    const payload = {
      id: "chatcmpl-e2e-stub",
      object: "chat.completion",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: buildContent(mode, text) },
          finish_reason: "stop",
        },
      ],
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(payload));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("ai-assist stub listening on http://127.0.0.1:" + String(port));
});
