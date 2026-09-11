import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { canonicalizeJson } from "@inpulse/canonical-json";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";

import { migrate } from "@inpulse/database/migrate";
import {
  parseCheckpointEnvelope,
  verifyCheckpointEnvelope,
} from "../src/checkpoint.js";
import type {
  ArchiveSigningKeyring,
  OpsConfig,
  WormCredentials,
} from "../src/config.js";
import { sha256Hex } from "../src/crypto.js";
import {
  decryptAuditExportPackage,
  parseAuditExportManifest,
  parseAuditExportPackage,
  verifyAuditExportManifest,
} from "../src/export.js";
import {
  checkpointObjectKey,
  exportObjectKey,
  readChainHeads,
  runCheckpoint,
  runExport,
} from "../src/run.js";

const PREFIX = "inpulse/audit";
const BUCKET = "inpulse-audit";

const signingKeys = new Map<number, Buffer>([
  [1, Buffer.alloc(32, 0x11)],
  [2, Buffer.alloc(32, 0x22)],
]);
const keyring: ArchiveSigningKeyring = { currentVersion: 2, keys: signingKeys };

interface SeedFixture {
  readonly chainId: string;
  readonly projectId: number;
  readonly recordHash: string;
  readonly requestId: string;
  readonly occurredAt: Date;
  readonly expectedOccurredAt: string;
  readonly headUpdatedAt: string;
  readonly windowFrom: Date;
  readonly windowTo: Date;
}

interface CapturedPut {
  readonly key: string;
  readonly body: Buffer;
  readonly headers: Readonly<Record<string, string>>;
}

interface WormStub {
  readonly fetchImpl: typeof fetch;
  readonly puts: CapturedPut[];
  readonly objects: Map<string, Buffer>;
}

let archiveUrl = "";
let archiveClient: DatabaseClient | undefined;
let seed: SeedFixture | undefined;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Set ${name}; PostgreSQL integration tests never silently skip`,
    );
  }
  return value;
}

function roleUrl(baseUrl: string, role: string): string {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

function archiveConfig(databaseUrl: string): OpsConfig {
  const worm: WormCredentials = {
    endpoint: new URL("https://worm.example.com"),
    region: "cn-north-1",
    bucket: BUCKET,
    accessKeyId: "AKIDARCHIVE",
    secretAccessKey: "archive-secret",
    prefix: PREFIX,
    forcePathStyle: true,
    objectLock: { mode: "COMPLIANCE", retainDays: 3650 },
  };
  return {
    databaseUrl,
    worm,
    signingKeyring: keyring,
    fetchTimeoutMs: 5_000,
  };
}

function objectKeyFromUrl(url: URL): string {
  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0);
  const bucket = decodeURIComponent(segments[0] ?? "");
  if (bucket !== BUCKET) {
    throw new Error(`unexpected WORM bucket in stub: ${bucket}`);
  }
  return segments
    .slice(1)
    .map((segment) => decodeURIComponent(segment))
    .join("/");
}

function createWormStub(): WormStub {
  const puts: CapturedPut[] = [];
  const objects = new Map<string, Buffer>();
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof URL ? input : new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const key = objectKeyFromUrl(url);
    if (method === "PUT") {
      const body = init?.body;
      if (!Buffer.isBuffer(body)) {
        throw new Error("WORM stub expects a Buffer PUT body");
      }
      objects.set(key, Buffer.from(body));
      puts.push({
        key,
        body: Buffer.from(body),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(null, { status: 200 });
    }
    const stored = objects.get(key);
    if (stored === undefined) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(stored), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, puts, objects };
}

async function expectPgError(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`expected PostgreSQL error ${code}, but it succeeded`);
}

async function seedArchiveFixture(
  client: DatabaseClient,
): Promise<SeedFixture> {
  const recordHash = randomBytes(32);
  const prevHash = Buffer.alloc(32);
  const dayOffset = randomInt(0, 360);
  const windowFrom = new Date(Date.UTC(2040, 0, 1) + dayOffset * 86_400_000);
  const windowTo = new Date(windowFrom.getTime() + 86_400_000);
  const occurredAt = new Date(windowFrom.getTime() + 43_200_000);
  const expectedOccurredAt = `${occurredAt.toISOString().slice(0, 19)}.000000Z`;
  const headUpdatedAt = "2039-12-31T23:59:59.500000Z";
  const loginName = `archive_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const code = `ARCH${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const requestId = randomUUID();

  return client.sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE app_owner");
    const [user] = await tx<Array<{ id: number }>>`
      INSERT INTO app.users (login_name, name, password_hash)
      VALUES (
        ${loginName},
        ${"Archive Fixture"},
        ${"$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture-hash"}
      )
      RETURNING id
    `;
    if (user === undefined) {
      throw new Error("user fixture insert returned no row");
    }
    const [project] = await tx<Array<{ id: number }>>`
      INSERT INTO app.projects (code, name, created_by)
      VALUES (${code}, ${`Archive ${code}`}, ${user.id})
      RETURNING id
    `;
    if (project === undefined) {
      throw new Error("project fixture insert returned no row");
    }
    await tx`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.id}, ${user.id})
    `;
    await tx`
      INSERT INTO app.modules (project_id, name, kind, created_by)
      VALUES (${project.id}, '未分类', 'UNCLASSIFIED', ${user.id})
    `;
    const chainId = `PROJECT:${project.id}`;
    await tx`
      INSERT INTO app.audit_chain_heads (
        chain_id,
        project_id,
        last_sequence,
        last_hash,
        key_version,
        updated_at
      )
      VALUES (
        ${chainId},
        ${project.id},
        1,
        ${recordHash},
        1,
        ${headUpdatedAt}::timestamptz
      )
    `;
    await tx`
      INSERT INTO app.audit_logs (
        chain_id,
        sequence_no,
        project_id,
        actor_type,
        actor_id,
        action,
        target_type,
        target_id,
        event_payload,
        request_id,
        client_request_id,
        ip_address,
        user_agent,
        occurred_at,
        prev_hash,
        record_hash,
        key_version,
        canonical_version
      )
      VALUES (
        ${chainId},
        1,
        ${project.id},
        'SYSTEM',
        NULL,
        'ARCHIVE_IT_SEED',
        'SYSTEM',
        NULL,
        ${JSON.stringify({ marker: "archive-integration" })}::jsonb,
        ${requestId},
        NULL,
        NULL,
        NULL,
        ${occurredAt.toISOString()}::timestamptz,
        ${prevHash},
        ${recordHash},
        1,
        'JCS-1'
      )
    `;
    return {
      chainId,
      projectId: project.id,
      recordHash: recordHash.toString("hex"),
      requestId,
      occurredAt,
      expectedOccurredAt,
      headUpdatedAt,
      windowFrom,
      windowTo,
    };
  });
}

beforeAll(async () => {
  const baseUrl = required("TEST_DATABASE_URL");
  const migratorUrl = roleUrl(baseUrl, "app_migrator");
  archiveUrl = roleUrl(baseUrl, "audit_archive_writer");
  await migrate(migratorUrl);

  const seeder = createDatabaseClient(migratorUrl, {
    applicationName: "inpulse-ops-archive-seed",
  });
  try {
    seed = await seedArchiveFixture(seeder);
  } finally {
    await seeder.close();
  }

  archiveClient = createDatabaseClient(archiveUrl, {
    applicationName: "inpulse-ops-archive-test",
    maxConnections: 2,
  });
});

afterAll(async () => {
  await archiveClient?.close();
});

describe("审计归档（真实 PostgreSQL + WORM 桩）", () => {
  test("checkpoint 为链头写签名 WORM 检查点并带对象锁", async () => {
    const fixture = seed!;
    const now = new Date("2041-01-02T03:04:05.000Z");
    const stub = createWormStub();

    const summary = await runCheckpoint(archiveConfig(archiveUrl), {
      fetchImpl: stub.fetchImpl,
      now: () => now,
    });
    expect(summary.mode).toBe("checkpoint");
    expect(summary.chainCount).toBeGreaterThanOrEqual(1);

    const heads = await readChainHeads(archiveClient!.sql);
    const head = heads.find((entry) => entry.chainId === fixture.chainId);
    expect(head).toMatchObject({
      projectId: fixture.projectId,
      lastSequenceNo: 1,
      lastHash: fixture.recordHash,
      keyVersion: 1,
      headUpdatedAt: fixture.headUpdatedAt,
    });

    const objectKey = checkpointObjectKey(PREFIX, fixture.chainId, now, 1);
    const put = stub.puts.find((entry) => entry.key === objectKey);
    expect(put).toBeDefined();
    expect(put!.headers["x-amz-object-lock-mode"]).toBe("COMPLIANCE");
    expect(put!.headers["authorization"]).toContain("AWS4-HMAC-SHA256");

    const envelope = parseCheckpointEnvelope(put!.body.toString("utf8"));
    verifyCheckpointEnvelope(envelope, keyring.keys);
    expect(put!.body.toString("utf8")).toBe(`${canonicalizeJson(envelope)}\n`);
    expect(envelope.signingKeyVersion).toBe(2);
    expect(envelope.payload).toMatchObject({
      kind: "AUDIT_CHAIN_CHECKPOINT",
      version: 1,
      generatedAt: "2041-01-02T03:04:05.000Z",
      chainId: fixture.chainId,
      projectId: fixture.projectId,
      lastSequenceNo: 1,
      lastHash: fixture.recordHash,
      keyVersion: 1,
      headUpdatedAt: fixture.headUpdatedAt,
    });
  });

  test("export 导出窗口明细：密文可解密且清单签名绑定密文", async () => {
    const fixture = seed!;
    const stub = createWormStub();
    const window = { from: fixture.windowFrom, to: fixture.windowTo };

    const summary = await runExport(
      archiveConfig(archiveUrl),
      { fetchImpl: stub.fetchImpl },
      window,
    );
    expect(summary.mode).toBe("export");
    expect(summary.packageObjectKey).toBe(exportObjectKey(PREFIX, window));
    expect(summary.manifestObjectKey).toBe(
      `${summary.packageObjectKey}.manifest.json`,
    );

    const [dbCount] = await archiveClient!.sql<Array<{ count: number }>>`
      SELECT count(*)::int AS count
        FROM app.audit_logs
       WHERE occurred_at >= ${window.from.toISOString()}::timestamptz
         AND occurred_at < ${window.to.toISOString()}::timestamptz
    `;
    expect(summary.rowCount).toBe(dbCount?.count);

    const packagePut = stub.puts.find(
      (entry) => entry.key === summary.packageObjectKey,
    );
    const manifestPut = stub.puts.find(
      (entry) => entry.key === summary.manifestObjectKey,
    );
    expect(packagePut).toBeDefined();
    expect(manifestPut).toBeDefined();

    const { header, plaintext } = decryptAuditExportPackage(
      packagePut!.body,
      keyring.keys,
    );
    expect(header.windowFrom).toBe(window.from.toISOString());
    expect(header.windowTo).toBe(window.to.toISOString());

    const rows = plaintext
      .toString("utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const exported = rows.find(
      (row) => row["recordHash"] === fixture.recordHash,
    );
    expect(exported).toMatchObject({
      chainId: fixture.chainId,
      sequenceNo: 1,
      projectId: fixture.projectId,
      actorType: "SYSTEM",
      actorId: null,
      action: "ARCHIVE_IT_SEED",
      targetType: "SYSTEM",
      requestId: fixture.requestId,
      occurredAt: fixture.expectedOccurredAt,
      prevHash: "00".repeat(32),
      recordHash: fixture.recordHash,
      keyVersion: 1,
      canonicalVersion: "JCS-1",
    });

    const manifest = parseAuditExportManifest(
      manifestPut!.body.toString("utf8"),
    );
    verifyAuditExportManifest(manifest, keyring.keys);
    expect(manifest.payload.packageObjectKey).toBe(summary.packageObjectKey);
    expect(manifest.payload.rowCount).toBe(header.rowCount);
    expect(manifest.payload.plaintextSha256).toBe(header.plaintextSha256);
    expect(manifest.payload.ciphertextSha256).toBe(
      sha256Hex(parseAuditExportPackage(packagePut!.body).ciphertext),
    );
  });

  test("空窗口导出可解密为空包", async () => {
    const stub = createWormStub();
    const window = {
      from: new Date("1990-01-01T00:00:00.000Z"),
      to: new Date("1990-01-02T00:00:00.000Z"),
    };

    const summary = await runExport(
      archiveConfig(archiveUrl),
      { fetchImpl: stub.fetchImpl },
      window,
    );
    expect(summary.rowCount).toBe(0);

    const put = stub.puts.find(
      (entry) => entry.key === summary.packageObjectKey,
    );
    expect(put).toBeDefined();
    const decrypted = decryptAuditExportPackage(put!.body, keyring.keys);
    expect(decrypted.header.rowCount).toBe(0);
    expect(decrypted.plaintext.length).toBe(0);
  });

  test("audit_archive_writer 只允许读取审计数据", async () => {
    const fixture = seed!;
    const probe = createDatabaseClient(archiveUrl, {
      applicationName: "inpulse-ops-archive-probe",
    });
    try {
      const [count] = await probe.sql<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM app.audit_logs
      `;
      expect(count?.count).toBeGreaterThanOrEqual(1);
      const [head] = await probe.sql<Array<{ chainId: string }>>`
        SELECT chain_id AS "chainId"
          FROM app.audit_chain_heads
         WHERE chain_id = ${fixture.chainId}
      `;
      expect(head?.chainId).toBe(fixture.chainId);

      await expectPgError(
        probe.sql`
          INSERT INTO app.audit_logs (
            chain_id,
            sequence_no,
            project_id,
            actor_type,
            actor_id,
            action,
            target_type,
            target_id,
            event_payload,
            request_id,
            client_request_id,
            ip_address,
            user_agent,
            occurred_at,
            prev_hash,
            record_hash,
            key_version,
            canonical_version
          )
          VALUES (
            'SYSTEM',
            999999,
            NULL,
            'SYSTEM',
            NULL,
            'ARCHIVE_PROBE_DENIED',
            'SYSTEM',
            NULL,
            '{}'::jsonb,
            'archive-probe',
            NULL,
            NULL,
            NULL,
            now(),
            decode(repeat('00', 32), 'hex'),
            decode(repeat('11', 32), 'hex'),
            1,
            'JCS-1'
          )
        `,
        "42501",
      );
      await expectPgError(
        probe.sql`
          UPDATE app.audit_chain_heads
             SET last_sequence = last_sequence
           WHERE chain_id = ${fixture.chainId}
        `,
        "42501",
      );
      await expectPgError(
        probe.sql`
          DELETE FROM app.audit_logs WHERE chain_id = ${fixture.chainId}
        `,
        "42501",
      );
      await expectPgError(probe.sql.unsafe("SET ROLE app_owner"), "42501");
    } finally {
      await probe.close();
    }
  });
});
