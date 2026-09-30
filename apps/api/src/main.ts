import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { trustedProxySetting } from "./trusted-proxy.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: string): unknown;
  };
  express.set(
    "trust proxy",
    trustedProxySetting(process.env["TRUSTED_PROXY_CIDRS"]),
  );
  app.setGlobalPrefix("api/v1");
  const port = process.env["PORT"] ?? 3000;
  // 仅由 scripts/dev-start.mjs --lan 设置：局域网共享时 API 退回 loopback，
  // 外部流量统一经 Vite 同源代理进入，避免直接暴露 API 端口。
  const host = process.env["INPULSE_API_HOST"]?.trim();
  if (host !== undefined && host.length > 0) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
}

void bootstrap();
