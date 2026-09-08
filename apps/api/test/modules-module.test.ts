import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { expect, test } from "vitest";
import {
  ModulesCommandPort,
  ModulesModule,
} from "../src/modules/modules/index.js";

test("public Nest module resolves its CommandPort without a global database or AppModule", async () => {
  const context = await NestFactory.createApplicationContext(ModulesModule, {
    logger: false,
  });
  try {
    expect(context.get(ModulesCommandPort)).toBeInstanceOf(ModulesCommandPort);
  } finally {
    await context.close();
  }
});
