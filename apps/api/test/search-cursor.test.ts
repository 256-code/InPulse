import { describe, expect, test } from "vitest";

import { SEARCH_CURSOR_MAX_LENGTH } from "@inpulse/api-contract";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import {
  SearchCursorError,
  SearchCursorService,
  SEARCH_CURSOR_TTL_MS,
} from "../src/modules/search/search-cursor.js";

function keyring(
  versions: readonly { readonly version: number; readonly key: Buffer }[],
  currentVersion: number,
): VersionedHmacKeyring {
  return VersionedHmacKeyring.fromEntries(versions, currentVersion);
}

const context = {
  actorUserId: 7,
  normalizedQuery: "登录",
  nowMs: 1_800_000_000_000,
};

describe("SearchCursorService", () => {
  test("签发可校验的不透明游标并绑定用户与查询", () => {
    const service = new SearchCursorService(
      keyring([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1),
    );
    const token = service.encode({
      ...context,
      afterId: 42n,
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(service.decode(token, context)).toBe(42n);
    expect(token.length).toBeLessThanOrEqual(SEARCH_CURSOR_MAX_LENGTH);
  });

  test("拒绝篡改签名", () => {
    const service = new SearchCursorService(
      keyring([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1),
    );
    const token = service.encode({
      ...context,
      afterId: 42n,
    });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(() => service.decode(tampered, context)).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        name: "SearchCursorError",
        reason: "signature",
      }),
    );
  });

  test("拒绝过期游标", () => {
    const service = new SearchCursorService(
      keyring([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1),
    );
    const token = service.encode({
      ...context,
      afterId: 42n,
      nowMs: context.nowMs - SEARCH_CURSOR_TTL_MS - 1,
    });

    expect(() => service.decode(token, context)).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        reason: "expired",
      }),
    );
  });

  test("拒绝跨用户或跨查询复用", () => {
    const service = new SearchCursorService(
      keyring([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1),
    );
    const token = service.encode({
      ...context,
      afterId: 42n,
    });

    expect(() =>
      service.decode(token, { ...context, actorUserId: 8 }),
    ).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        reason: "actor-mismatch",
      }),
    );
    expect(() =>
      service.decode(token, { ...context, normalizedQuery: "其他" }),
    ).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        reason: "query-mismatch",
      }),
    );
  });

  test("拒绝畸形游标和缺失 keyring 版本", () => {
    const service = new SearchCursorService(
      keyring([{ version: 1, key: Buffer.alloc(32, 0x42) }], 1),
    );

    expect(() => service.decode("not-a-cursor", context)).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        reason: "malformed",
      }),
    );

    const rotating = new SearchCursorService(
      keyring(
        [
          { version: 1, key: Buffer.alloc(32, 0x42) },
          { version: 2, key: Buffer.alloc(32, 0x24) },
        ],
        2,
      ),
    );
    const token = rotating.encode({
      ...context,
      afterId: 42n,
    });
    expect(() => service.decode(token, context)).toThrowError(
      expect.objectContaining<Partial<SearchCursorError>>({
        reason: "version",
      }),
    );
  });
});
