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
  await app.listen(process.env["PORT"] ?? 3000);
}

void bootstrap();
