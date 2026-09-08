import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { expect, test } from "vitest";

import {
  PostgresSearchProjectionWritePort,
  SearchProjectionModule,
  SearchProjectionWritePort,
} from "../src/modules/search/index.js";

test("SearchProjectionModule exposes the public write port", async () => {
  const context = await NestFactory.createApplicationContext(
    SearchProjectionModule,
    { logger: false },
  );
  try {
    expect(context.get(SearchProjectionWritePort)).toBeInstanceOf(
      PostgresSearchProjectionWritePort,
    );
  } finally {
    await context.close();
  }
});
