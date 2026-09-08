import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import {
  blockedUntil,
  windowStartedAt,
} from "../src/auth/auth-rate-limit.policy.js";
import { PostgresAuthRateLimitRepository } from "../src/auth/auth-rate-limit.repository.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let unitOfWork: PostgresUnitOfWork;
let repository: PostgresAuthRateLimitRepository;
const createdHashes: Buffer[] = [];

async function countBuckets(
  bucketType: "ACCOUNT" | "IP" | "GLOBAL",
  dimensionHash: Buffer,
): Promise<number> {
  const rows = (await client!.sql`
    SELECT count(*)::int AS count
      FROM app.auth_rate_limit_buckets
     WHERE bucket_type = ${bucketType}
       AND dimension_hash = ${dimensionHash}
  `) as unknown as readonly { count: number }[];
  return rows[0]?.count ?? 0;
}

function checkDimension(hash: Buffer) {
  return {
    bucketType: "ACCOUNT" as const,
    dimensionHashes: [hash],
  };
}

function writeDimension(
  hash: Buffer,
  windowStart: Date,
  maxAttempts: number,
  blockUntil: Date,
) {
  return {
    bucketType: "ACCOUNT" as const,
    dimensionHash: hash,
    windowStartedAt: windowStart,
    maxAttempts,
    blockedUntil: blockUntil,
  };
}

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-auth-rate-limit-integration-test",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  repository = new PostgresAuthRateLimitRepository();
});

afterAll(async () => {
  if (client !== undefined) {
    for (const hash of createdHashes) {
      await client.sql`
        DELETE FROM app.auth_rate_limit_buckets
         WHERE dimension_hash = ${hash}
      `;
    }
  }
  await client?.close();
});

describe("登录限流桶（真实 PostgreSQL）", () => {
  test("同一窗口内原子递增并在达到阈值时阻断", async () => {
    const hash = randomBytes(32);
    createdHashes.push(hash);
    const now = new Date();
    const windowStart = windowStartedAt(now, 15 * 60);
    const blockUntil = blockedUntil(now, 15 * 60);

    await unitOfWork.run((tx) =>
      repository.recordFailures(
        tx,
        [writeDimension(hash, windowStart, 3, blockUntil)],
        now,
      ),
    );
    await unitOfWork.run((tx) =>
      repository.recordFailures(
        tx,
        [writeDimension(hash, windowStart, 3, blockUntil)],
        now,
      ),
    );
    const blocked = await unitOfWork.run((tx) =>
      repository.findBlocked(tx, [checkDimension(hash)], now),
    );
    expect(blocked).toBeUndefined();
    expect(await countBuckets("ACCOUNT", hash)).toBe(1);

    await unitOfWork.run((tx) =>
      repository.recordFailures(
        tx,
        [writeDimension(hash, windowStart, 3, blockUntil)],
        now,
      ),
    );
    const afterThreshold = await unitOfWork.run((tx) =>
      repository.findBlocked(tx, [checkDimension(hash)], now),
    );
    expect(afterThreshold).toMatchObject({ bucketType: "ACCOUNT" });
  });

  test("阻断跨窗口边界仍然生效", async () => {
    const hash = randomBytes(32);
    createdHashes.push(hash);
    const baseWindow = windowStartedAt(new Date(), 15 * 60);
    const now = new Date(baseWindow.getTime() + 14 * 60 * 1000 + 30 * 1000);
    const blockUntil = blockedUntil(now, 15 * 60);
    const later = new Date(baseWindow.getTime() + 16 * 60 * 1000);

    await unitOfWork.run((tx) =>
      repository.recordFailures(
        tx,
        [writeDimension(hash, baseWindow, 1, blockUntil)],
        now,
      ),
    );

    const blocked = await unitOfWork.run((tx) =>
      repository.findBlocked(tx, [checkDimension(hash)], later),
    );
    expect(blocked).toMatchObject({ bucketType: "ACCOUNT" });
  });

  test("clearAccount 只清除账号桶，不影响 IP 桶", async () => {
    const accountHash = randomBytes(32);
    const ipHash = randomBytes(32);
    createdHashes.push(accountHash, ipHash);
    const now = new Date();
    const windowStart = windowStartedAt(now, 15 * 60);
    const blockUntil = blockedUntil(now, 15 * 60);

    await unitOfWork.run((tx) =>
      repository.recordFailures(
        tx,
        [
          writeDimension(accountHash, windowStart, 5, blockUntil),
          {
            bucketType: "IP",
            dimensionHash: ipHash,
            windowStartedAt: windowStart,
            maxAttempts: 5,
            blockedUntil: blockUntil,
          },
        ],
        now,
      ),
    );
    await unitOfWork.run((tx) => repository.clearAccount(tx, [accountHash]));

    expect(await countBuckets("ACCOUNT", accountHash)).toBe(0);
    expect(await countBuckets("IP", ipHash)).toBe(1);
  });
});
