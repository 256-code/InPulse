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
    const created = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
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
    const first = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
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
    const created = await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );
    await requireClient().sql`
      UPDATE app.preauth_sessions
         SET expires_at = now() - INTERVAL '1 minute'
       WHERE id = ${created.id}
    `;

    const consumed = await unitOfWork.run((tx) =>
      repository.consumeOnce(tx, created.id),
    );
    expect(consumed).toBe(false);
  });

  test("数据库唯一约束拒绝重复 CSRF 哈希，防跨会话复用", async () => {
    const material = service.issuePreauthMaterial();
    await unitOfWork.run((tx) =>
      repository.create(tx, {
        tokenHash: material.sessionTokenHash,
        tokenHashKeyVersion: material.tokenHashKeyVersion,
        csrfTokenHash: material.csrfTokenHash,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );

    await expect(
      unitOfWork.run((tx) =>
        repository.create(tx, {
          tokenHash: randomBytes(32),
          tokenHashKeyVersion: material.tokenHashKeyVersion,
          csrfTokenHash: material.csrfTokenHash,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        }),
      ),
    ).rejects.toThrow();
  });
});
