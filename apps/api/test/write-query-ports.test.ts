import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { expect, test } from "vitest";
import {
  ModuleQueryPort,
  ModulesModule,
} from "../src/modules/modules/index.js";
import {
  FeatureQueryPort,
  FeaturesModule,
} from "../src/modules/features/index.js";

test("domain Nest modules expose write-check ports without a database provider", async () => {
  const modules = await NestFactory.createApplicationContext(ModulesModule, {
    logger: false,
  });
  const features = await NestFactory.createApplicationContext(FeaturesModule, {
    logger: false,
  });
  try {
    expect(modules.get(ModuleQueryPort)).toBeInstanceOf(ModuleQueryPort);
    expect(features.get(FeatureQueryPort)).toBeInstanceOf(FeatureQueryPort);
  } finally {
    await features.close();
    await modules.close();
  }
});
