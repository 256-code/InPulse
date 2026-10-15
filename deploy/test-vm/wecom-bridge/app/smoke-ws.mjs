import { WebSocket } from "ws";

const ws = new WebSocket("wss://openws.work.weixin.qq.com", { handshakeTimeout: 15000 });
ws.on("open", () => { console.log("WS-OPEN"); ws.close(); process.exit(0); });
ws.on("error", (error) => { console.error("WS-ERR", error && error.message ? error.message : String(error)); process.exit(1); });
setTimeout(() => { console.error("WS-TIMEOUT"); process.exit(1); }, 20000);
