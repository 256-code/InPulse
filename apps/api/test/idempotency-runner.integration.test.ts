import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { IdempotencyRunner } from "../src/idempotency/runner.js";
import { PostgresIdempotencyStore } from "../src/idempotency/store.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let store: PostgresIdempotencyStore;
let runner: IdempotencyRunner;

const requestHash = Buffer.from("ab".repeat(32), "hex");
const key = "integration-idempotency-key-20260908";

function command(
  idempotencyKey: string = key,
  hash: Buffer = requestHash,
): {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyContractVersion: string;
  readonly requestHash: Buffer;
  readonly requestHashKeyVersion: number;
  readonly expiresAt: Date;
  readonly replayPolicyVersion: string;
  readonly replayAuthPolicyVersion: string;
} {
  return {
    operationId: "createProject",
    idempotencyKey,
    idempotencyContractVersion: "1.0.0",
    requestHash: hash,
    requestHashKeyVersion: 1,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    replayPolicyVersion: "1.0.0",
    replayAuthPolicyVersion: "1.0.0",
  };
}

function result() {
  return {
    responseStatus: 201,
    responseSchemaRef: "LoginResponse",
    responseHasBody: true,
    responseBody: { id: 1 },
    replayAuthContext: {},
  };
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-idempotency-runner-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  store = new PostgresIdempotencyStore();
  runner = new IdempotencyRunner(unitOfWork, store);
});

afterAll(async () => {
  await client?.close();
});

describe("幂等 runner（真实 PostgreSQL）", () => {
  test("新请求与业务写在同一事务执行并保存可重放响应", async () => {
    const actorId = await createUser(client!.sql);
    let executions = 0;

    const outcome = await runner.run({
      actorId,
      command: command(),
      execute: async (tx) => {
        executions += 1;
        await tx.sql`
          UPDATE app.users
             SET name = 'idempotency-executed',
                 row_version = row_version + 1
           WHERE id = ${actorId}
        `;
        return result();
      },
    });

    expect(outcome.kind).toBe("executed");
    expect(executions).toBe(1);
    const stored = await unitOfWork.run((tx) =>
      store.find(tx, actorId, "createProject", key),
    );
    expect(stored?.state).toBe("SUCCEEDED");
    expect(stored?.responseStatus).toBe(201);
  });

  test("业务失败会回滚业务写和幂等 PENDING 行，后续可重试", async () => {
    const actorId = await createUser(client!.sql);

    await expect(
      runner.run({
        actorId,
        command: command(),
        execute: async (tx) => {
          await tx.sql`
            UPDATE app.users
               SET name = 'idempotency-should-rollback',
                   row_version = row_version + 1
             WHERE id = ${actorId}
          `;
          throw new Error("business failure");
        },
      }),
    ).rejects.toThrow("business failure");

    const stored = await unitOfWork.run((tx) =>
      store.find(tx, actorId, "createProject", key),
    );
    expect(stored).toBeUndefined();
    const rows = (await client!.sql`
      SELECT name FROM app.users WHERE id = ${actorId}
    `) as unknown as readonly { name: string }[];
    expect(rows[0]?.name).not.toBe("idempotency-should-rollback");

    let executed = 0;
    const retried = await runner.run({
      actorId,
      command: command(),
      execute: async () => {
        executed += 1;
        return result();
      },
    });
    expect(retried.kind).toBe("executed");
    expect(executed).toBe(1);
  });

  test("并发同 Key 只执行一次，重放前调用重放授权器", async () => {
    const actorId = await createUser(client!.sql);
    let executions = 0;
    let replayChecks = 0;

    const first = runner.run({
      actorId,
      command: command(),
      execute: async () => {
        executions += 1;
        return result();
      },
    });
    const second = runner.run({
      actorId,
      command: command(),
      execute: async () => {
        executions += 1;
        return result();
      },
      replayAuthorizer: async () => {
        replayChecks += 1;
      },
    });

    const outcomes = await Promise.all([first, second]);
    expect(executions).toBe(1);
    expect(replayChecks).toBe(1);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      "executed",
      "replayed",
    ]);
  });
});
