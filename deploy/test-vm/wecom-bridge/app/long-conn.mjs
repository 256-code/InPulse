// InPulse x 企业微信智能机器人（长连接）PoC 验证脚本
// 用途：验证 aibot_subscribe 订阅、回调接收、aibot_send_msg 主动推送
// 用法：node wecom-long-conn-poc.mjs <config.json>
// 说明：临时验证工具，不进入 InPulse 仓库，不承载生产逻辑。
// 2026-10-13 改造（ADR-070 桥接侧批次）：
//   机器人凭据不再写在 config.json，改为从 InPulse 数据库 app.wecom_robot_config
//   读取 AES-256-GCM 密文，用同一 keyring 文件解密；轮询 row_version，
//   管理员在设置页保存新机器人后本进程自动重连生效。
//   config.json 键：databaseUrl、keyringFile、configPollMs；
//   仍兼容旧的静态键 botId/secret（静态模式不轮询、不自动重连）。
import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import {
  BINDING_FAILURE_REASONS,
  PROJECT_BINDING_FAILURE_REASONS,
  redeemBindingCode,
  redeemProjectGroupCode,
} from "./binding-code.mjs";
import { WebSocket } from "ws";
import pg from "pg";

const { Pool } = pg;
const WS_URL = "wss://openws.work.weixin.qq.com";
const HEARTBEAT_MS = 30000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const EXTRA_PUSH_DELAY_MS = 3000;
const OPEN = 1;
const PUSH_INTERVAL_MS = 1200;
const DEFAULT_CONFIG_POLL_MS = 5000;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const SECRET_AAD = Buffer.from("app.wecom_robot_config.secret", "utf8");
const KEYRING_ENTRY = /^([1-9][0-9]*)\s*:\s*([0-9a-fA-F]{64,})\s*$/;

const configPath = process.argv[2];
if (!configPath) {
  console.error("用法: node wecom-long-conn-poc.mjs <config.json>");
  process.exit(2);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(
    "读取 config.json 失败:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(2);
}

const databaseUrl =
  typeof process.env.DATABASE_URL === "string" &&
  process.env.DATABASE_URL.trim().length > 0
    ? process.env.DATABASE_URL.trim()
    : typeof config.databaseUrl === "string"
      ? config.databaseUrl.trim()
      : "";
const keyringFile =
  typeof config.keyringFile === "string" ? config.keyringFile.trim() : "";
const dbMode = databaseUrl.length > 0;
if (dbMode && keyringFile.length === 0) {
  console.error("config.json 配置 databaseUrl 时还需要 keyringFile");
  process.exit(2);
}
if (
  !dbMode &&
  (typeof config.botId !== "string" ||
    config.botId.length === 0 ||
    typeof config.secret !== "string" ||
    config.secret.length === 0)
) {
  console.error(
    "config.json 需要 databaseUrl + keyringFile（推荐），或静态 botId 与 secret",
  );
  process.exit(2);
}

const commandFile =
  typeof config.commandFile === "string" && config.commandFile.length > 0
    ? config.commandFile
    : configPath.endsWith(".json")
      ? configPath.slice(0, -5) + "-commands.txt"
      : configPath + "-commands.txt";
const pushOnCallback = config.pushOnCallback !== false;
const extraUserIds = Array.isArray(config.extraUserIds)
  ? config.extraUserIds.filter(
      (value) => typeof value === "string" && value.length > 0,
    )
  : [];
const configPollMs =
  Number(config.configPollMs) > 0
    ? Number(config.configPollMs)
    : DEFAULT_CONFIG_POLL_MS;

const pool = dbMode
  ? new Pool({ connectionString: databaseUrl, max: 2 })
  : null;

let commandOffset = 0;

function pollCommandFile() {
  let raw;
  try {
    raw = readFileSync(commandFile, "utf8");
  } catch {
    return;
  }
  if (raw.length <= commandOffset) {
    if (raw.length < commandOffset) commandOffset = 0;
    return;
  }
  const chunk = raw.slice(commandOffset);
  commandOffset = raw.length;
  for (const line of chunk.split(/\r?\n/)) {
    if (line.trim().length > 0) log("执行命令文件指令:", line.trim());
    handleStdinLine(line);
  }
}

let socket = null;
let seq = 0;
let subscribed = false;
let awaitingSubscribeResponse = false;
let heartbeat = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let closing = false;
let extraPushDone = false;
let activeCreds = null;
let refreshing = false;
let warnedNoConfig = false;
const observedUserIds = new Set();

function log(...parts) {
  console.log("[" + new Date().toISOString() + "]", ...parts);
}

function nextReqId() {
  seq += 1;
  return "poc-" + seq + "-" + Date.now();
}

function sendCommand(cmd, body) {
  if (socket === null || socket.readyState !== OPEN) {
    log("连接不可用，未发送:", cmd);
    return null;
  }
  const reqId = nextReqId();
  const frame = { cmd: cmd, headers: { req_id: reqId } };
  if (body !== undefined) frame.body = body;
  socket.send(JSON.stringify(frame));
  return reqId;
}

function loadKeyringKeys() {
  const content = readFileSync(keyringFile, "utf8");
  const keys = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const match = KEYRING_ENTRY.exec(line);
    if (match === null) throw new Error("keyring 行格式非法");
    keys.set(Number.parseInt(match[1], 10), Buffer.from(match[2], "hex"));
  }
  if (keys.size === 0) throw new Error("keyring 为空");
  return keys;
}

function decryptRobotSecret(ciphertext, keyVersion) {
  const keys = loadKeyringKeys();
  const key = keys.get(keyVersion);
  if (key === undefined)
    throw new Error("keyring 中缺少主密钥版本 " + keyVersion);
  const buf = Buffer.isBuffer(ciphertext)
    ? ciphertext
    : Buffer.from(ciphertext);
  if (buf.length < NONCE_BYTES + TAG_BYTES + 1) throw new Error("密文长度非法");
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(NONCE_BYTES, NONCE_BYTES + TAG_BYTES);
  const body = buf.subarray(NONCE_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAAD(SECRET_AAD);
  decipher.setAuthTag(tag);
  const secret = Buffer.concat([
    decipher.update(body),
    decipher.final(),
  ]).toString("utf8");
  if (secret.length === 0) throw new Error("解密结果为空");
  return secret;
}

async function refreshCredentials() {
  if (pool === null || refreshing) return;
  refreshing = true;
  try {
    const result = await pool.query(
      "SELECT bot_id, secret_ciphertext, secret_key_version, row_version FROM app.wecom_robot_config WHERE id = 1",
    );
    const row = result.rows[0];
    if (row === undefined) {
      if (!warnedNoConfig) {
        warnedNoConfig = true;
        log("数据库中尚无机器人配置（等待管理员在设置页保存）");
      }
      return;
    }
    warnedNoConfig = false;
    const rowVersion = Number(row.row_version);
    if (
      activeCreds !== null &&
      activeCreds.rowVersion === rowVersion &&
      activeCreds.botId === row.bot_id
    ) {
      return;
    }
    const secret = decryptRobotSecret(
      row.secret_ciphertext,
      Number(row.secret_key_version),
    );
    const firstLoad = activeCreds === null;
    activeCreds = { botId: row.bot_id, secret: secret, rowVersion: rowVersion };
    if (firstLoad) {
      log(
        "已从数据库读取机器人配置 bot_id=" +
          row.bot_id +
          " row_version=" +
          rowVersion +
          " secret=****" +
          secret.slice(-4),
      );
      ensureConnected();
    } else {
      log(
        "检测到机器人配置变更 bot_id=" +
          row.bot_id +
          " row_version=" +
          rowVersion +
          "，自动重连",
      );
      restartConnection();
    }
  } catch (error) {
    log(
      "读取机器人配置失败（保留现状，继续等待）:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    refreshing = false;
  }
}

const pushQueue = [];
function enqueuePush(label, run) {
  pushQueue.push({ label: label, run: run });
  log("已入发送队列（" + pushQueue.length + " 条待发）:", label);
}
setInterval(() => {
  if (pushQueue.length === 0) return;
  if (socket === null || socket.readyState !== OPEN || !subscribed) return;
  const next = pushQueue.shift();
  next.run();
}, PUSH_INTERVAL_MS);

function sendMarkdown(userId, content) {
  enqueuePush("markdown -> " + userId, () => {
    const reqId = sendCommand("aibot_send_msg", {
      chatid: userId,
      chat_type: 1,
      msgtype: "markdown",
      markdown: { content: content },
    });
    if (reqId !== null) log("已发起 markdown 主动推送 ->", userId);
  });
}

function sendMarkdownToGroup(chatId, content) {
  enqueuePush("markdown -> group " + chatId, () => {
    const reqId = sendCommand("aibot_send_msg", {
      chatid: chatId,
      chat_type: 2,
      msgtype: "markdown",
      markdown: { content: content },
    });
    if (reqId !== null) log("已发起 markdown 群推送 ->", chatId);
  });
}

function sendCard(userId, title, desc, url) {
  enqueuePush("template_card -> " + userId, () => {
    const reqId = sendCommand("aibot_send_msg", {
      chatid: userId,
      chat_type: 1,
      msgtype: "template_card",
      template_card: {
        card_type: "text_notice",
        main_title: { title: title, desc: desc },
        sub_title_text: "InPulse 任务指派通知（PoC）",
        card_action: { type: 1, url: url },
      },
    });
    if (reqId !== null) log("已发起 template_card 主动推送 ->", userId);
  });
}

function onSubscribed() {
  log("订阅成功：长连接已就绪，等待回调或主动推送");
  if (extraUserIds.length > 0 && !extraPushDone) {
    extraPushDone = true;
    setTimeout(() => {
      for (const userId of extraUserIds) {
        log("向配置中的 extraUserIds 推送（验证未交互用户能否收到）:", userId);
        sendMarkdown(
          userId,
          "**InPulse PoC**" +
            String.fromCharCode(10) +
            "这是一条给未交互用户的主动推送测试消息。",
        );
      }
    }, EXTRA_PUSH_DELAY_MS);
  }
}

async function tryRedeemBindingCode(rawText, wecomUserId) {
  if (!dbMode || pool === null) return false;
  const result = await redeemBindingCode(pool, rawText, wecomUserId);
  if (result.outcome === "not-a-code") return false;
  if (result.outcome === "bound") {
    log(
      "绑定码兑换成功：wecom userid =",
      wecomUserId,
      "-> InPulse 用户",
      result.userId,
      result.displayName,
    );
    sendMarkdown(
      wecomUserId,
      "**绑定成功**" +
        String.fromCharCode(10) +
        String.fromCharCode(10) +
        "已绑定 InPulse 账号「" +
        result.displayName +
        "」。指派给你的任务会由我在这里提醒你。",
    );
  } else {
    log(
      "绑定码兑换失败：userid =",
      wecomUserId,
      "sqlstate =",
      result.sqlState,
      "message =",
      result.error && result.error.message
        ? result.error.message
        : String(result.error),
    );
    sendMarkdown(
      wecomUserId,
      "**绑定未完成**" +
        String.fromCharCode(10) +
        String.fromCharCode(10) +
        (BINDING_FAILURE_REASONS[result.sqlState] ||
          BINDING_FAILURE_REASONS.UNKNOWN),
    );
  }
  return true;
}

async function tryRedeemProjectGroupCode(rawText, wecomChatId, wecomUserId) {
  if (!dbMode || pool === null) return false;
  const result = await redeemProjectGroupCode(
    pool,
    rawText,
    wecomChatId,
    wecomUserId,
  );
  if (result.outcome === "not-a-code") return false;
  if (result.outcome === "bound") {
    log(
      "项目群绑定成功：chat =",
      wecomChatId,
      "project =",
      result.projectId,
      result.projectName,
      "rebound =",
      result.rebound,
    );
    sendMarkdownToGroup(
      wecomChatId,
      (result.rebound ? "**群绑定已更新**" : "**绑定成功**") +
        String.fromCharCode(10) +
        String.fromCharCode(10) +
        (result.rebound
          ? "本群已重新绑定到 InPulse 项目「" + result.projectName + "」。"
          : "本群已绑定 InPulse 项目「" +
            result.projectName +
            "」。如需解绑请在 InPulse 项目页操作。"),
    );
  } else {
    log(
      "项目群绑定失败：chat =",
      wecomChatId,
      "userid =",
      wecomUserId,
      "sqlstate =",
      result.sqlState,
      "message =",
      result.error && result.error.message
        ? result.error.message
        : String(result.error),
    );
    sendMarkdownToGroup(
      wecomChatId,
      "**绑定未完成**" +
        String.fromCharCode(10) +
        String.fromCharCode(10) +
        (PROJECT_BINDING_FAILURE_REASONS[result.sqlState] ||
          PROJECT_BINDING_FAILURE_REASONS.UNKNOWN),
    );
  }
  return true;
}

async function handleCallback(frame) {
  const body = frame.body || {};
  const userId = body.from && body.from.userid ? body.from.userid : null;
  if (userId !== null && !observedUserIds.has(userId)) {
    observedUserIds.add(userId);
    log("发现用户 userid:", userId);
  }
  console.log("  原始回调:", JSON.stringify(frame).slice(0, 1200));
  if (frame.cmd === "aibot_event_callback") {
    const eventType =
      body.event && body.event.eventtype ? body.event.eventtype : "unknown";
    log(
      "收到事件回调:",
      eventType,
      "userid=",
      userId,
      "chattype=",
      body.chattype,
    );
    if (eventType === "disconnected_event") {
      log("本连接已被新连接踢下线（单个机器人同时只允许一条长连接）");
      return;
    }
    if (eventType === "enter_chat" && pushOnCallback && userId !== null) {
      sendMarkdown(
        userId,
        "**InPulse PoC**" +
          String.fromCharCode(10) +
          "收到进入会话事件，userid = " +
          userId +
          "。这条是主动推送。",
      );
    }
    return;
  }
  const msgType = body.msgtype || "unknown";
  log("收到消息回调:", msgType, "userid=", userId, "chattype=", body.chattype);
  const isGroupChat =
    body.chattype === "group" &&
    typeof body.chatid === "string" &&
    body.chatid.length > 0;
  if (msgType === "text" && body.text && body.text.content) {
    const content = String(body.text.content);
    log("  文本内容:", content.slice(0, 100));
    if (isGroupChat && userId !== null) {
      const handled = await tryRedeemProjectGroupCode(
        content,
        body.chatid,
        userId,
      );
      if (handled) return;
      log("  群消息不是项目绑定码，保持安静");
      return;
    }
    if (userId !== null) {
      const handled = await tryRedeemBindingCode(content, userId);
      if (handled) return;
    }
  }
  if (pushOnCallback && userId !== null && !isGroupChat) {
    sendMarkdown(
      userId,
      "**InPulse PoC**" +
        String.fromCharCode(10) +
        "已收到你的消息，userid = " +
        userId +
        "。这条是 aibot_send_msg 主动推送。",
    );
  }
}

function handleFrame(raw) {
  let frame;
  try {
    frame = JSON.parse(raw);
  } catch {
    log("收到非 JSON 帧:", String(raw).slice(0, 200));
    return;
  }
  const cmd = frame.cmd;
  if (cmd === "pong") return;
  if (cmd === "aibot_msg_callback" || cmd === "aibot_event_callback") {
    void handleCallback(frame).catch((error) => {
      log(
        "回调处理异常:",
        error && error.message ? error.message : String(error),
      );
    });
    return;
  }
  if (typeof frame.errcode === "number") {
    log(
      "收到响应:",
      frame.headers && frame.headers.req_id,
      "errcode=" + frame.errcode,
      "errmsg=" + (frame.errmsg || ""),
    );
    if (awaitingSubscribeResponse) {
      awaitingSubscribeResponse = false;
      if (frame.errcode === 0) {
        subscribed = true;
        reconnectDelay = RECONNECT_BASE_MS;
        onSubscribed();
      } else {
        log("订阅未成功，关闭当前连接并按退避重试");
        const ws = socket;
        socket = null;
        if (ws !== null) {
          try {
            ws.close();
          } catch {
            /* connection already closed */
          }
        }
        scheduleReconnect();
      }
    }
    return;
  }
  log("未识别帧:", JSON.stringify(frame).slice(0, 500));
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeat = setInterval(() => {
    if (subscribed) sendCommand("ping", undefined);
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function scheduleReconnect() {
  if (closing || reconnectTimer !== null) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  log("将在", delay, "毫秒后重连");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function ensureConnected() {
  if (closing || socket !== null || reconnectTimer !== null) return;
  connect();
}

function connect() {
  if (closing) return;
  if (activeCreds === null) {
    log("尚无可用机器人配置，暂不连接");
    return;
  }
  log("连接", WS_URL, "bot_id=" + activeCreds.botId);
  const ws = new WebSocket(WS_URL, { handshakeTimeout: 15000 });
  socket = ws;

  ws.on("open", () => {
    if (socket !== ws) return;
    log("WebSocket 握手成功，发送 aibot_subscribe");
    awaitingSubscribeResponse = true;
    const reqId = sendCommand("aibot_subscribe", {
      bot_id: activeCreds.botId,
      secret: activeCreds.secret,
    });
    if (reqId === null) {
      awaitingSubscribeResponse = false;
      try {
        ws.close();
      } catch {
        /* connection already closed */
      }
      return;
    }
    startHeartbeat();
  });

  ws.on("message", (data) => {
    if (socket !== ws) return;
    handleFrame(data.toString("utf8"));
  });

  ws.on("close", (code, reason) => {
    log("连接关闭 code=", code, "reason=", reason ? reason.toString() : "");
    if (socket !== ws) return;
    socket = null;
    subscribed = false;
    awaitingSubscribeResponse = false;
    stopHeartbeat();
    if (!closing) scheduleReconnect();
  });

  ws.on("error", (error) => {
    if (socket !== ws) return;
    log("连接错误:", error && error.message ? error.message : String(error));
  });
}

function restartConnection() {
  reconnectDelay = RECONNECT_BASE_MS;
  subscribed = false;
  awaitingSubscribeResponse = false;
  stopHeartbeat();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const old = socket;
  socket = null;
  if (old !== null) {
    try {
      old.close();
    } catch {
      /* connection already closed */
    }
  }
  log("准备使用新配置重连（500 毫秒后）");
  setTimeout(() => {
    if (!closing && socket === null) connect();
  }, 500);
}

function shutdown() {
  closing = true;
  stopHeartbeat();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket !== null) socket.close();
  log("已退出");
  process.exit(0);
}

function handleStdinLine(line) {
  const text = line.trim();
  if (text.length === 0) return;
  const parts = text.split(" ");
  const command = parts[0];
  if (command === "quit" || command === "exit") {
    shutdown();
    return;
  }
  if (command === "ping") {
    sendCommand("ping", undefined);
    return;
  }
  if (command === "users") {
    log("已观察到的 userid:", [...observedUserIds].join(", ") || "(无)");
    return;
  }
  if (command === "whoami" || command === "config") {
    if (activeCreds === null) {
      log("当前无机器人配置");
    } else {
      log(
        "当前机器人 bot_id=" +
          activeCreds.botId +
          " row_version=" +
          (dbMode ? activeCreds.rowVersion : "(静态)"),
      );
    }
    return;
  }
  if (command === "push" || command === "card") {
    const userId = parts[1];
    if (!userId) {
      log("用法: push <userid> [文本] 或 card <userid> [文本]");
      return;
    }
    const rest = parts
      .slice(2)
      .join(" ")
      .replaceAll("\\n", String.fromCharCode(10));
    if (command === "push") {
      sendMarkdown(
        userId,
        rest.length > 0
          ? rest
          : "**InPulse PoC**" +
              String.fromCharCode(10) +
              "手动触发的主动推送。",
      );
    } else {
      sendCard(
        userId,
        "任务指派：PoC 卡片",
        rest.length > 0 ? rest : "手动触发",
        "https://example.com",
      );
    }
    return;
  }
  if (command === "raw") {
    const userId = parts[1];
    if (!userId || parts.length < 3) {
      log("用法: raw <userid> <JSON>");
      return;
    }
    const jsonText = parts.slice(2).join(" ");
    let payload;
    try {
      payload = JSON.parse(jsonText);
    } catch (error) {
      log(
        "raw 指令 JSON 解析失败:",
        error && error.message ? error.message : String(error),
      );
      return;
    }
    enqueuePush("raw -> " + userId, () => {
      const reqId = sendCommand(
        "aibot_send_msg",
        Object.assign({ chatid: userId, chat_type: 1 }, payload),
      );
      if (reqId !== null) log("已发起 raw 推送 ->", userId);
    });
    return;
  }
  log(
    "可用命令: push <userid> [文本] | card <userid> | raw <userid> <JSON> | ping | users | config | quit",
  );
}

process.on("SIGINT", shutdown);
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of String(chunk).split(/\r?\n/)) handleStdinLine(line);
});

try {
  commandOffset = readFileSync(commandFile, "utf8").length;
} catch {
  commandOffset = 0;
}
setInterval(pollCommandFile, 1000);
log("命令文件:", commandFile);
log("InPulse x 企业微信智能机器人长连接 PoC 启动");
log("观察 userid：在企业微信里给机器人发一条消息，或直接进入机器人会话");

if (dbMode) {
  log("机器人凭据来源：数据库，每 " + configPollMs + " 毫秒检查配置变更");
  await refreshCredentials();
  if (activeCreds === null) {
    log("首次读取配置未成功，将按轮询自动重试");
  }
  setInterval(() => {
    refreshCredentials();
  }, configPollMs);
} else {
  activeCreds = { botId: config.botId, secret: config.secret, rowVersion: 0 };
  log("机器人凭据来源：config.json 静态配置 bot_id=" + activeCreds.botId);
  connect();
}
