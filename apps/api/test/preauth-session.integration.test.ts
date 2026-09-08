import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import {
  PostgresPreauthSessionRepository,
  type PreauthSessionRepository,
} from "../src/auth/preauth-session.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let repository: PreauthSessionRepository;
let service: SessionTokenService;

function requireClient(): DatabaseClient {
  if (client === undefined) {
    throw new Error("database client is not initialized");
  }
  return client;
}

/** 用数据库时钟计算有效期，避免 JS 与 PostgreSQL 时钟偏差触发 expiry CHECK。 */
async function dbFutureExpiry(minutes = 9): Promise<Date> {
  const rows = await requireClient().sql<
    Array<{ readonly expires_at: Date }>
  >`select now() + make_interval(mins => ${minutes}) as expires_at`;
  return rows[0]!.expires_at;
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-preauth-session-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  repository = new PostgresPreauthSessionRepository();
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  service = new SessionTokenService(keyring);
});

afterAll(async () => {
  await client?.close();
});

describe("PostgresPreauthSessionRepository (真实 PostgreSQL)", () => {
  test("创建后可按令牌哈希查回，哈希与密钥版本落库", async () => {
    const material = service.issuePreauthMaterial();
    const expiresAt = await dbFutureExpiry();
    const created = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt,
      }),
    );
    const found = await unitOfWork.run((tx) =>
      repository.findByTokenHash(tx, material.sessionTokenHash),
    );

    expect(found?.id).toBe(created.id);
    expect(found?.tokenHash.equals(material.sessionTokenHash)).toBe(true);
    expect(found?.csrfTokenHash.equals(material.csrfTokenHash)).toBe(true);
    expect(found?.tokenHashKeyVersion).toBe(1);
  });

  test("同一预认证 Session 只能原子消费一次", async () => {
    const material = service.issuePreauthMaterial();
    const expiresAt = await dbFutureExpiry();
    const first = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt,
      }),
    );

    const firstConsume = await unitOfWork.run((tx) =>
      repository.consumeOnce(tx, first.id),
    );
    const secondConsume = await unitOfWork.run((tx) =>
      repository.consumeOnce(tx, first.id),
    );
    expect(firstConsume).toBe(true);
    expect(secondConsume).toBe(false);
  });

  test("过期预认证 Session 不可消费", async () => {
    const material = service.issuePreauthMaterial();
    const expiresAt = await dbFutureExpiry();
    const created = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt,
      }),
    );

    const consumed = await unitOfWork.run((tx) =>
      repository.consumeOnce(
        tx,
        created.id,
        new Date(Date.now() + 11 * 60 * 1000),
      ),
    );
    expect(consumed).toBe(false);
  });

  test("数据库唯一约束拒绝重复 CSRF 哈希，防跨会话复用", async () => {
    const material = service.issuePreauthMaterial();
    const expiresAt = await dbFutureExpiry();
    await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt,
      }),
    );

    const otherExpiry = await dbFutureExpiry();
    await expect(
      unitOfWork.run((tx) =>
        repository.create(tx, {
          tokenHash: randomBytes(32),
          tokenHashKeyVersion: material.tokenHashKeyVersion,
          csrfTokenHash: material.csrfTokenHash,
          expiresAt: otherExpiry,
        }),
      ),
    ).rejects.toThrow();
  });
});
