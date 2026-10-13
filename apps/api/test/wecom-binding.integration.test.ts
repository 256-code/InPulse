import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { migrate } from "../../../database/src/migrate.ts";
import { hashOpaqueToken } from "../src/auth/token.js";
import {
  generateWecomBindingCode,
  hashWecomBindingCode,
} from "../src/modules/wecom-binding/wecom-binding.service.js";
import {
  connect,
  createUser,
  testUrls,
  type TestUrls,
} from "./database.helpers.js";

const SESSION_COOKIE_NAME = "__Host-session";
const KEY_VERSION = 1;
const BINDING_PATH = "/api/v1/me/wecom-binding";

interface SessionActor {
  readonly userId: number;
  readonly loginName: string;
  readonly cookie: string;
}

let app: NestExpressApplication | undefined;
let baseUrl = "";
let urls: TestUrls;
let runtime: Sql | undefined;
let keyringDirectory: string | undefined;
let previousEnvironment: Readonly<Record<string, string | undefined>> = {};
let sessionKey: Buffer;

function requireRuntime(): Sql {
  if (runtime === undefined) {
    throw new Error("runtime connection is not initialised");
  }
  return runtime;
}

function randomWecomId(): string {
  return `wecom-test-${randomBytes(6).toString("hex")}`;
}

async function sessionActor(sql: Sql, userId: number): Promise<SessionActor> {
  const users = (await sql`
    SELECT login_name AS "loginName", auth_version AS "authVersion"
      FROM app.users
     WHERE id = ${userId}
  `) as unknown as readonly { loginName: string; authVersion: number }[];
  const user = users[0];
  if (user === undefined) {
    throw new Error(`user fixture ${userId} does not exist`);
  }
  const cookieToken = randomBytes(32).toString("base64url");
  await sql`
    INSERT INTO app.user_sessions (
      user_id,
      token_hash,
      token_hash_key_version,
      auth_version_at_issue,
      auth_state,
      idle_expires_at,
      absolute_expires_at
    )
    VALUES (
      ${userId},
      ${hashOpaqueToken(cookieToken, sessionKey)},
      ${KEY_VERSION},
      ${user.authVersion},
      'AUTHENTICATED',
      now() + interval '1 hour',
      now() + interval '1 day'
    )
  `;
  return {
    userId,
    loginName: user.loginName,
    cookie: `${SESSION_COOKIE_NAME}=${cookieToken}`,
  };
}

async function issueCsrf(cookie: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { readonly csrfToken: string };
  return body.csrfToken;
}

function mutationHeaders(cookie: string): Record<string, string> {
  return {
    cookie,
    host: new URL(baseUrl).host,
    origin: new URL(baseUrl).origin,
  };
}

async function getBinding(cookie: string | undefined): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    headers["cookie"] = cookie;
  }
  return fetch(`${baseUrl}${BINDING_PATH}`, { headers });
}

async function createCode(
  cookie: string,
  csrf: string | undefined,
): Promise<Response> {
  const headers = mutationHeaders(cookie);
  if (csrf !== undefined) {
    headers["x-csrf-token"] = csrf;
  }
  return fetch(`${baseUrl}${BINDING_PATH}/codes`, {
    method: "POST",
    headers,
  });
}

async function deleteBinding(
  cookie: string,
  csrf: string,
  idempotencyKey: string | undefined,
): Promise<Response> {
  const headers = mutationHeaders(cookie);
  headers["x-csrf-token"] = csrf;
  if (idempotencyKey !== undefined) {
    headers["idempotency-key"] = idempotencyKey;
  }
  return fetch(`${baseUrl}${BINDING_PATH}`, { method: "DELETE", headers });
}

async function redeem(
  sql: Sql,
  code: string,
  wecomUserId: string,
): Promise<readonly { user_id: number; display_name: string }[]> {
  return (await sql`
    SELECT * FROM app.redeem_wecom_binding_code(
      ${hashWecomBindingCode(code)},
      ${wecomUserId}
    )
  `) as unknown as readonly { user_id: number; display_name: string }[];
}

async function redeemErrorCode(
  sql: Sql,
  code: string,
  wecomUserId: string,
): Promise<string> {
  try {
    await redeem(sql, code, wecomUserId);
  } catch (error) {
    return (error as { readonly code?: string }).code ?? "unknown";
  }
  throw new Error("redeem unexpectedly succeeded");
}

async function bindingStatusRow(
  sql: Sql,
  userId: number,
): Promise<{ status: string; wecomUserid: string } | undefined> {
  const rows = (await sql`
    SELECT status, wecom_userid AS "wecomUserid"
      FROM app.user_wecom_bindings
     WHERE user_id = ${userId}
     ORDER BY id DESC
     LIMIT 1
  `) as unknown as readonly { status: string; wecomUserid: string }[];
  return rows[0];
}

async function expectPrivilegeDenied(
  sql: Sql,
  statement: string,
): Promise<void> {
  try {
    await sql.unsafe(statement);
  } catch (error) {
    expect((error as { readonly code?: string }).code).toBe("42501");
    return;
  }
  throw new Error(`statement unexpectedly allowed: ${statement}`);
}

beforeAll(async () => {
  urls = testUrls();
  runtime = connect(urls.runtime, 20);
  await migrate(urls.migrator);

  sessionKey = randomBytes(32);
  const auditKey = randomBytes(32);
  const idempotencyKey = randomBytes(32);
  keyringDirectory = await mkdtemp(join(tmpdir(), "inpulse-wecom-binding-"));
  const sessionFile = join(keyringDirectory, "session.keyring");
  const auditFile = join(keyringDirectory, "audit.keyring");
  const idempotencyFile = join(keyringDirectory, "idempotency.keyring");
  await writeFile(
    sessionFile,
    `${KEY_VERSION}:${sessionKey.toString("hex")}\n`,
    "utf8",
  );
  await writeFile(
    auditFile,
    `${KEY_VERSION}:${auditKey.toString("hex")}\n`,
    "utf8",
  );
  await writeFile(
    idempotencyFile,
    `${KEY_VERSION}:${idempotencyKey.toString("hex")}\n`,
    "utf8",
  );

  previousEnvironment = {
    AUDIT_DATABASE_URL: process.env["AUDIT_DATABASE_URL"],
    AUDIT_HMAC_KEYRING_FILE: process.env["AUDIT_HMAC_KEYRING_FILE"],
    AUDIT_HMAC_KEYRING_TEST_PATH: process.env["AUDIT_HMAC_KEYRING_TEST_PATH"],
    AUDIT_HMAC_KEY_VERSION: process.env["AUDIT_HMAC_KEY_VERSION"],
    DATABASE_URL: process.env["DATABASE_URL"],
    IDEMPOTENCY_FINGERPRINT_KEYRING_FILE:
      process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_FILE"],
    IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH:
      process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH"],
    IDEMPOTENCY_FINGERPRINT_KEY_VERSION:
      process.env["IDEMPOTENCY_FINGERPRINT_KEY_VERSION"],
    NODE_ENV: process.env["NODE_ENV"],
    SESSION_HASH_KEYRING_FILE: process.env["SESSION_HASH_KEYRING_FILE"],
    SESSION_HASH_KEYRING_TEST_PATH:
      process.env["SESSION_HASH_KEYRING_TEST_PATH"],
    SESSION_HASH_KEY_VERSION: process.env["SESSION_HASH_KEY_VERSION"],
  };
  process.env["NODE_ENV"] = "test";
  process.env["DATABASE_URL"] = urls.runtime;
  process.env["AUDIT_DATABASE_URL"] = urls.auditReader;
  process.env["SESSION_HASH_KEYRING_FILE"] = sessionFile;
  process.env["SESSION_HASH_KEYRING_TEST_PATH"] = "1";
  process.env["SESSION_HASH_KEY_VERSION"] = String(KEY_VERSION);
  process.env["AUDIT_HMAC_KEYRING_FILE"] = auditFile;
  process.env["AUDIT_HMAC_KEYRING_TEST_PATH"] = "1";
  process.env["AUDIT_HMAC_KEY_VERSION"] = String(KEY_VERSION);
  process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_FILE"] = idempotencyFile;
  process.env["IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH"] = "1";
  process.env["IDEMPOTENCY_FINGERPRINT_KEY_VERSION"] = String(KEY_VERSION);

  const { AppModule } = await import("../src/app.module.js");
  app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix("api/v1");
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end({ timeout: 5 });
  for (const [name, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  if (keyringDirectory !== undefined) {
    await rm(keyringDirectory, { recursive: true, force: true });
  }
});

describe("企微机器人绑定（真实 PostgreSQL + 真实 HTTP）", () => {
  test("匿名 GET 被拒绝：401 且不泄露绑定状态", async () => {
    const response = await getBinding(undefined);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { readonly code: string }).code).toBe(
      "WECOM_BINDING_UNAUTHENTICATED",
    );
  });

  test("新用户 GET 返回 UNBOUND 且时间戳为 null", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const response = await getBinding(actor.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      state: "UNBOUND",
      boundAt: null,
      codeExpiresAt: null,
      botProfileUrl: null,
    });
  });

  test("管理员配置机器人链接后，绑定状态返回 botProfileUrl", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));

    // 单行配置表在此前用例中为空，botProfileUrl 应为 null。
    const before = await getBinding(actor.cookie);
    expect(
      ((await before.json()) as Record<string, unknown>)["botProfileUrl"],
    ).toBeNull();

    // 直接写入配置行（密文任意 29 字节以上即可；绑定状态不做解密）。
    await sql`
      INSERT INTO app.wecom_robot_config (
        id,
        bot_id,
        secret_ciphertext,
        secret_key_version,
        secret_hint,
        updated_by,
        row_version,
        bot_profile_url
      ) VALUES (
        1,
        'aib-binding-profile-bot',
        ${randomBytes(32)},
        1,
        'test',
        ${actor.userId},
        1,
        'https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only'
      )
      ON CONFLICT (id) DO UPDATE SET
        bot_profile_url = EXCLUDED.bot_profile_url
    `;
    try {
      const after = await getBinding(actor.cookie);
      expect(after.status).toBe(200);
      expect(
        ((await after.json()) as Record<string, unknown>)["botProfileUrl"],
      ).toBe(
        "https://work.weixin.qq.com/wework_admin/common/openBotProfile/test-only",
      );
    } finally {
      // app_runtime 无 DELETE 授权：只清链接，行留给 robot 用例自行清理。
      await sql`
        UPDATE app.wecom_robot_config
           SET bot_profile_url = NULL
         WHERE id = 1
      `;
    }
  });

  test("POST codes：201 明文码只返回一次，库内只存 Hash，状态转 PENDING", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);
    const response = await createCode(actor.cookie, csrf);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as {
      readonly code: string;
      readonly expiresAt: string;
    };
    expect(body.code).toMatch(
      /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/,
    );
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());

    const stored = (await sql`
      SELECT code_hash AS "codeHash", consumed_at AS "consumedAt"
        FROM app.wecom_binding_codes
       WHERE user_id = ${actor.userId}
    `) as unknown as readonly {
      codeHash: Buffer;
      consumedAt: string | null;
    }[];
    expect(stored.length).toBe(1);
    expect(stored[0]?.consumedAt).toBeNull();
    expect(
      Buffer.compare(stored[0]!.codeHash, hashWecomBindingCode(body.code)),
    ).toBe(0);

    const plaintextRows = (await sql`
      SELECT count(*)::int AS "count"
        FROM app.wecom_binding_codes
       WHERE user_id = ${actor.userId}
         AND encode(code_hash, 'hex') = ${Buffer.from(body.code, "utf8").toString("hex")}
    `) as unknown as readonly { count: number }[];
    expect(plaintextRows[0]?.count).toBe(0);

    const status = (await (await getBinding(actor.cookie)).json()) as {
      readonly state: string;
      readonly codeExpiresAt: string | null;
    };
    expect(status.state).toBe("PENDING");
    expect(status.codeExpiresAt).not.toBeNull();
  });

  test("重新签发覆盖旧码：旧码兑换返回 WBC01", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);
    const first = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    const second = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    expect(second.code).not.toBe(first.code);
    expect(await redeemErrorCode(sql, first.code, randomWecomId())).toBe(
      "WBC01",
    );
  });

  test("兑换成功：BOUND、boundAt 非空、绑定行 ACTIVE，重复兑换 WBC02", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);
    const created = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    const wecomUserId = randomWecomId();
    const redeemed = await redeem(sql, created.code, wecomUserId);
    expect(redeemed).toEqual([
      { user_id: actor.userId, display_name: expect.any(String) },
    ]);

    const status = (await (await getBinding(actor.cookie)).json()) as {
      readonly state: string;
      readonly boundAt: string | null;
      readonly codeExpiresAt: string | null;
    };
    expect(status.state).toBe("BOUND");
    expect(status.boundAt).not.toBeNull();
    expect(status.codeExpiresAt).toBeNull();

    expect(await bindingStatusRow(sql, actor.userId)).toEqual({
      status: "ACTIVE",
      wecomUserid: wecomUserId,
    });
    expect(await redeemErrorCode(sql, created.code, randomWecomId())).toBe(
      "WBC02",
    );
  });

  test("同一企微账号绑定第二个用户：WBC06，原绑定与新码都不受影响", async () => {
    const sql = requireRuntime();
    const firstUser = await createUser(sql);
    const firstActor = await sessionActor(sql, firstUser);
    const firstCsrf = await issueCsrf(firstActor.cookie);
    const firstCode = (await (
      await createCode(firstActor.cookie, firstCsrf)
    ).json()) as {
      readonly code: string;
    };
    const wecomUserId = randomWecomId();
    await redeem(sql, firstCode.code, wecomUserId);

    const secondActor = await sessionActor(sql, await createUser(sql));
    const secondCsrf = await issueCsrf(secondActor.cookie);
    const secondCode = (await (
      await createCode(secondActor.cookie, secondCsrf)
    ).json()) as {
      readonly code: string;
    };
    expect(await redeemErrorCode(sql, secondCode.code, wecomUserId)).toBe(
      "WBC06",
    );
    expect(await bindingStatusRow(sql, firstUser)).toEqual({
      status: "ACTIVE",
      wecomUserid: wecomUserId,
    });

    const replacement = randomWecomId();
    expect((await redeem(sql, secondCode.code, replacement)).length).toBe(1);
  });

  test("同一用户换绑新企微账号：更新原行、row_version 递增", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);

    const firstCode = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    await redeem(sql, firstCode.code, randomWecomId());
    const before = (await sql`
      SELECT id, row_version AS "rowVersion"
        FROM app.user_wecom_bindings
       WHERE user_id = ${actor.userId}
    `) as unknown as readonly { id: number; rowVersion: number }[];
    expect(before.length).toBe(1);

    const newWecomId = randomWecomId();
    const secondCode = (await (
      await createCode(actor.cookie, csrf)
    ).json()) as {
      readonly code: string;
    };
    await redeem(sql, secondCode.code, newWecomId);
    const after = (await sql`
      SELECT id, row_version AS "rowVersion", wecom_userid AS "wecomUserid", status
        FROM app.user_wecom_bindings
       WHERE user_id = ${actor.userId}
    `) as unknown as readonly {
      id: number;
      rowVersion: number;
      wecomUserid: string;
      status: string;
    }[];
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(before[0]?.id);
    expect(after[0]?.rowVersion).toBe((before[0]?.rowVersion ?? 0) + 1);
    expect(after[0]?.wecomUserid).toBe(newWecomId);
    expect(after[0]?.status).toBe("ACTIVE");
  });

  test("DELETE 解绑：204 回 UNBOUND、绑定转 REVOKED、同 Key 重放 204", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);
    const created = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    const wecomUserId = randomWecomId();
    await redeem(sql, created.code, wecomUserId);

    const key = randomBytes(16).toString("hex");
    const first = await deleteBinding(actor.cookie, csrf, key);
    expect(first.status).toBe(204);
    expect(await first.text()).toBe("");

    const status = (await (await getBinding(actor.cookie)).json()) as {
      readonly state: string;
      readonly boundAt: string | null;
    };
    expect(status.state).toBe("UNBOUND");
    expect(status.boundAt).toBeNull();
    expect(await bindingStatusRow(sql, actor.userId)).toEqual({
      status: "REVOKED",
      wecomUserid: wecomUserId,
    });

    const replay = await deleteBinding(actor.cookie, csrf, key);
    expect(replay.status).toBe(204);
    expect(await replay.text()).toBe("");
  });

  test("DELETE 缺 Idempotency-Key 返回 400；缺 CSRF 头 422、错 Token 401", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);

    const missingKey = await deleteBinding(actor.cookie, csrf, undefined);
    expect(missingKey.status).toBe(400);
    expect(((await missingKey.json()) as { readonly code: string }).code).toBe(
      "IDEMPOTENCY_KEY_REQUIRED",
    );

    const missingCsrf = await fetch(`${baseUrl}${BINDING_PATH}`, {
      method: "DELETE",
      headers: {
        ...mutationHeaders(actor.cookie),
        "idempotency-key": randomBytes(16).toString("hex"),
      },
    });
    expect(missingCsrf.status).toBe(422);
    expect(((await missingCsrf.json()) as { readonly code: string }).code).toBe(
      "VALIDATION_FAILED",
    );

    // 格式合法但未知的 CSRF Token 在鉴权层被拒（401）
    const wrongCsrf = await deleteBinding(
      actor.cookie,
      "a".repeat(43),
      randomBytes(16).toString("hex"),
    );
    expect(wrongCsrf.status).toBe(401);
    expect(((await wrongCsrf.json()) as { readonly code: string }).code).toBe(
      "WECOM_BINDING_UNAUTHENTICATED",
    );

    const postWithoutCsrf = await createCode(actor.cookie, "a".repeat(43));
    expect(postWithoutCsrf.status).toBe(401);
    expect(
      ((await postWithoutCsrf.json()) as { readonly code: string }).code,
    ).toBe("WECOM_BINDING_UNAUTHENTICATED");
  });

  test("解绑会作废待用码：该码再兑换返回 WBC02", async () => {
    const sql = requireRuntime();
    const actor = await sessionActor(sql, await createUser(sql));
    const csrf = await issueCsrf(actor.cookie);
    const created = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };

    const key = randomBytes(16).toString("hex");
    expect((await deleteBinding(actor.cookie, csrf, key)).status).toBe(204);
    expect(await redeemErrorCode(sql, created.code, randomWecomId())).toBe(
      "WBC02",
    );
  });

  test("停用用户兑换绑定码返回 WBC04，且不产生绑定", async () => {
    const sql = requireRuntime();
    const userId = await createUser(sql);
    const actor = await sessionActor(sql, userId);
    const csrf = await issueCsrf(actor.cookie);
    const created = (await (await createCode(actor.cookie, csrf)).json()) as {
      readonly code: string;
    };
    await sql`
      UPDATE app.users
         SET status = 'DISABLED',
             disabled_at = now(),
             row_version = row_version + 1
       WHERE id = ${userId}
    `;
    expect(await redeemErrorCode(sql, created.code, randomWecomId())).toBe(
      "WBC04",
    );
    expect(await bindingStatusRow(sql, userId)).toBeUndefined();
  });

  test("过期绑定码兑换返回 WBC05", async () => {
    const sql = requireRuntime();
    const userId = await createUser(sql);
    const code = generateWecomBindingCode();
    await sql`
      INSERT INTO app.wecom_binding_codes
        (user_id, code_hash, expires_at, created_at)
      VALUES (
        ${userId},
        ${hashWecomBindingCode(code)},
        now() - interval '5 minutes',
        now() - interval '15 minutes'
      )
    `;
    expect(await redeemErrorCode(sql, code, randomWecomId())).toBe("WBC05");
  });

  test("非法 Hash 长度兑换返回 WBC03", async () => {
    const sql = requireRuntime();
    let code: string | undefined;
    try {
      await sql`SELECT * FROM app.redeem_wecom_binding_code(${Buffer.alloc(5)}, ${randomWecomId()})`;
    } catch (error) {
      code = (error as { readonly code?: string }).code;
    }
    expect(code).toBe("WBC03");
  });

  test("权限探针：runtime 无 DELETE、backup 只读、runtime 不能切换 app_owner", async () => {
    const sql = requireRuntime();
    await expectPrivilegeDenied(sql, "DELETE FROM app.wecom_binding_codes");
    await expectPrivilegeDenied(sql, "DELETE FROM app.user_wecom_bindings");

    const backup = connect(urls.backup, 2);
    try {
      const rows = (await backup`
        SELECT count(*)::int AS "count" FROM app.wecom_binding_codes
      `) as unknown as readonly { count: number }[];
      expect(rows[0]?.count).toBeGreaterThanOrEqual(0);
      await expectPrivilegeDenied(
        backup,
        "UPDATE app.wecom_binding_codes SET consumed_at = now()",
      );
      await expectPrivilegeDenied(
        backup,
        "DELETE FROM app.user_wecom_bindings",
      );
    } finally {
      await backup.end({ timeout: 5 });
    }

    const probe = connect(urls.runtime, 1);
    try {
      await expectPrivilegeDenied(probe, "SET ROLE app_owner");
    } finally {
      await probe.end({ timeout: 5 });
    }
  });
});
