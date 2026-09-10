import { describe, expect, test } from "vitest";

import { AGGREGATE_READ_CURSOR_MAX_LENGTH } from "@inpulse/api-contract";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import {
  AggregateReadCursorError,
  AggregateReadCursorService,
  AGGREGATE_READ_CURSOR_TTL_MS,
  type AggregateReadCursorErrorReason,
  type AggregateReadCursorNamespace,
} from "../src/modules/aggregate-read/aggregate-read-cursor.js";

function build(
  versions: readonly { readonly version: number; readonly key: Buffer }[],
  currentVersion: number,
): AggregateReadCursorService {
  return new AggregateReadCursorService(
    VersionedHmacKeyring.fromEntries(versions, currentVersion),
  );
}

function service(): AggregateReadCursorService {
  return build([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1);
}

const nowMs = 1_800_000_000_000;

const context = {
  actorUserId: 7,
  namespace: "MY_TASKS" as AggregateReadCursorNamespace,
  filterKey: JSON.stringify([null, null, null, null]),
  nowMs,
};

function expectReason(
  run: () => unknown,
  reason: AggregateReadCursorErrorReason,
): void {
  expect(run).toThrowError(
    expect.objectContaining<Partial<AggregateReadCursorError>>({
      name: "AggregateReadCursorError",
      reason,
    }),
  );
}

describe("AggregateReadCursorService", () => {
  test("签发不透明游标并绑定 actor、命名空间与筛选", () => {
    const cursors = service();
    const token = cursors.encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs,
    });

    expect(token.includes(".")).toBe(true);
    expect(/[^A-Za-z0-9_.-]/.test(token)).toBe(false);
    expect(token.length).toBeLessThanOrEqual(AGGREGATE_READ_CURSOR_MAX_LENGTH);
    expect(cursors.decode(token, context)).toBe(42);
    expect(cursors.decode(undefined, context)).toBeNull();

    const groupToken = cursors.encode({
      actorUserId: 7,
      namespace: "TASK_GROUP_RECORDS",
      filterKey: "TASK_GROUP_RECORDS:11:all",
      afterId: 99,
      nowMs,
    });
    expect(
      cursors.decode(groupToken, {
        ...context,
        namespace: "TASK_GROUP_RECORDS",
        filterKey: "TASK_GROUP_RECORDS:11:all",
      }),
    ).toBe(99);
    expectReason(
      () => cursors.decode(groupToken, context),
      "namespace-mismatch",
    );
  });

  test("拒绝篡改签名", () => {
    const cursors = service();
    const token = cursors.encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs,
    });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    expectReason(() => cursors.decode(tampered, context), "signature");
  });

  test("拒绝过期游标并保留 TTL 边界", () => {
    const cursors = service();
    const atBoundary = cursors.encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs: nowMs - AGGREGATE_READ_CURSOR_TTL_MS,
    });
    expectReason(() => cursors.decode(atBoundary, context), "expired");

    const justInside = cursors.encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs: nowMs - AGGREGATE_READ_CURSOR_TTL_MS + 1,
    });
    expect(cursors.decode(justInside, context)).toBe(42);
  });

  test("拒绝跨用户与跨筛选复用", () => {
    const cursors = service();
    const token = cursors.encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs,
    });

    expectReason(
      () => cursors.decode(token, { ...context, actorUserId: 8 }),
      "actor-mismatch",
    );
    expectReason(
      () =>
        cursors.decode(token, {
          ...context,
          filterKey: JSON.stringify([9, null, null, null]),
        }),
      "filter-mismatch",
    );
  });

  test("拒绝畸形游标与缺失 keyring 版本", () => {
    const cursors = service();
    expectReason(() => cursors.decode("not-a-cursor", context), "malformed");
    expectReason(() => cursors.decode("a.b.c", context), "malformed");
    expectReason(() => cursors.decode(".signature", context), "malformed");
    expectReason(() => cursors.decode("payload.", context), "malformed");
    expectReason(() => cursors.decode("!!!.AAA", context), "malformed");
    expectReason(
      () =>
        cursors.decode(
          Buffer.from("notjson", "utf8").toString("base64url") + "." + "AAAA",
          context,
        ),
      "malformed",
    );

    const rotating = build([{ version: 2, key: Buffer.alloc(32, 0x24) }], 2);
    const token = service().encode({
      actorUserId: 7,
      namespace: "MY_TASKS",
      filterKey: context.filterKey,
      afterId: 42,
      nowMs,
    });
    expectReason(() => rotating.decode(token, context), "version");
  });

  test("签发拒绝非正整数的 afterId", () => {
    const cursors = service();
    expect(() =>
      cursors.encode({
        actorUserId: 7,
        namespace: "MY_TASKS",
        filterKey: context.filterKey,
        afterId: 0,
        nowMs,
      }),
    ).toThrowError(/positive integer/);
  });
});
