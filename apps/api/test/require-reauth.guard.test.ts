import "reflect-metadata";
import { describe, expect, test, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";

import { RequireReauthGuard } from "../src/auth/require-reauth.guard";
import type { PostgresUnitOfWork } from "../src/database/unit-of-work";
import type { SessionAuthService } from "../src/auth/session-auth.service";

function contextWithCookie(cookie?: string): ExecutionContext {
  const request = { headers: cookie === undefined ? {} : { cookie } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function actor() {
  return {
    sessionId: 1,
    userId: 1,
    authState: "AUTHENTICATED" as const,
    authVersionAtIssue: 1,
  };
}

function guardWith(
  resolveActor: SessionAuthService["resolveActorInTransaction"],
  metaRow: unknown | undefined,
) {
  const tx = {
    sql: vi.fn().mockResolvedValue(metaRow === undefined ? [] : [metaRow]),
  };
  const unitOfWork = {
    run: vi.fn(async (callback: (value: unknown) => unknown) => callback(tx)),
  } as unknown as PostgresUnitOfWork;
  return new RequireReauthGuard(
    {
      resolveActorInTransaction: resolveActor,
    } as unknown as SessionAuthService,
    unitOfWork,
  );
}

describe("RequireReauthGuard", () => {
  test("未登录时抛 401", async () => {
    const guard = guardWith(vi.fn().mockResolvedValue(undefined), undefined);
    await expect(
      guard.canActivate(contextWithCookie(undefined)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  test("非管理员抛 403", async () => {
    const guard = guardWith(vi.fn().mockResolvedValue(actor()), {
      isAdmin: false,
      reauthenticatedAt: new Date(),
      mfaVerifiedAt: new Date(),
    });
    await expect(
      guard.canActivate(contextWithCookie("__Host-session=abc")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test("重认证超过 5 分钟抛 403", async () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000);
    const guard = guardWith(vi.fn().mockResolvedValue(actor()), {
      isAdmin: true,
      reauthenticatedAt: stale,
      mfaVerifiedAt: stale,
    });
    await expect(
      guard.canActivate(contextWithCookie("__Host-session=abc")),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  test("管理员且重认证在 5 分钟内通过", async () => {
    const now = new Date(Date.now() - 60_000);
    const guard = guardWith(vi.fn().mockResolvedValue(actor()), {
      isAdmin: true,
      reauthenticatedAt: now,
      mfaVerifiedAt: now,
    });
    await expect(
      guard.canActivate(contextWithCookie("__Host-session=abc")),
    ).resolves.toBe(true);
  });
});
