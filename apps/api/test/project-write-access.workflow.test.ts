import { describe, expect, test, vi } from "vitest";

import type { AuthenticatedSessionActor } from "../src/auth/session-auth.service.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type {
  FeatureForWriteResource,
  FeatureWriteCheckResult,
} from "../src/modules/features/index.js";
import type {
  ModuleForWriteResource,
  ModuleWriteCheckResult,
} from "../src/modules/modules/index.js";
import type {
  ProjectForWriteResource,
  ProjectWriteCheckResult,
} from "../src/modules/projects/index.js";
import { ProjectWriteAccessWorkflow } from "../src/workflows/index.js";

const tx = (): TransactionContext => ({ db: {} as never, sql: {} as never });

const actor: AuthenticatedSessionActor = {
  sessionId: 11,
  userId: 7,
  authState: "AUTHENTICATED",
  authVersionAtIssue: 1,
};

const project: ProjectForWriteResource = {
  projectId: 1,
  status: "ACTIVE",
  rowVersion: 1,
  isSystemAdmin: false,
};

const moduleResource: ModuleForWriteResource = {
  projectId: 1,
  moduleId: 2,
  status: "ACTIVE",
  rowVersion: 1,
};

const featureResource: FeatureForWriteResource = {
  projectId: 1,
  moduleId: 2,
  featureId: 3,
  status: "ACTIVE",
  rowVersion: 1,
};

function setup(
  overrides: {
    actor?: AuthenticatedSessionActor | undefined;
    project?: ProjectWriteCheckResult;
    module?: ModuleWriteCheckResult;
    feature?: FeatureWriteCheckResult;
  } = {},
) {
  const calls: string[] = [];
  const sessionAuth = {
    resolveActorInTransaction: vi.fn(async () => {
      calls.push("session");
      return "actor" in overrides ? overrides.actor : actor;
    }),
  };
  const projectAccess = {
    checkProjectForWrite: vi.fn(async () => {
      calls.push("project");
      return overrides.project ?? { kind: "allowed", resource: project };
    }),
  };
  const modules = {
    checkModuleForWrite: vi.fn(async () => {
      calls.push("module");
      return overrides.module ?? { kind: "allowed", resource: moduleResource };
    }),
  };
  const features = {
    checkFeatureForWrite: vi.fn(async () => {
      calls.push("feature");
      return (
        overrides.feature ?? { kind: "allowed", resource: featureResource }
      );
    }),
  };
  const workflow = new ProjectWriteAccessWorkflow(
    sessionAuth as never,
    projectAccess as never,
    modules as never,
    features as never,
  );
  return { calls, sessionAuth, projectAccess, modules, features, workflow };
}

describe("ProjectWriteAccessWorkflow", () => {
  test("module allowed 按 session -> project -> module 顺序返回完整摘要", async () => {
    const { calls, sessionAuth, projectAccess, modules, workflow } = setup();
    const context = tx();

    const result = await workflow.checkModuleForWrite(context, {
      cookieHeader: "__Host-session=token",
      projectId: 1,
      moduleId: 2,
    });

    expect(result).toEqual({
      kind: "allowed",
      actor,
      project,
      module: moduleResource,
    });
    expect(calls).toEqual(["session", "project", "module"]);
    expect(sessionAuth.resolveActorInTransaction).toHaveBeenCalledWith(
      context,
      "__Host-session=token",
    );
    expect(projectAccess.checkProjectForWrite).toHaveBeenCalledWith(context, {
      actorUserId: 7,
      projectId: 1,
    });
    expect(modules.checkModuleForWrite).toHaveBeenCalledWith(context, {
      projectId: 1,
      moduleId: 2,
    });
  });

  test("actor 未认证时不查询项目、模块或功能", async () => {
    const { calls, projectAccess, modules, features, workflow } = setup({
      actor: undefined,
    });

    await expect(
      workflow.checkFeatureForWrite(tx(), {
        cookieHeader: undefined,
        projectId: 1,
        moduleId: 2,
        featureId: 3,
      }),
    ).resolves.toEqual({ kind: "unauthenticated" });

    expect(calls).toEqual(["session"]);
    expect(projectAccess.checkProjectForWrite).not.toHaveBeenCalled();
    expect(modules.checkModuleForWrite).not.toHaveBeenCalled();
    expect(features.checkFeatureForWrite).not.toHaveBeenCalled();
  });

  test("项目 not-found / parent-not-active 会阻断模块和功能检查", async () => {
    const cases: ProjectWriteCheckResult[] = [
      { kind: "not-found" },
      {
        kind: "parent-not-active",
        resource: { ...project, status: "ARCHIVED" },
      },
    ];

    for (const projectResult of cases) {
      const { calls, modules, features, workflow } = setup({
        project: projectResult,
      });
      const expected =
        projectResult.kind === "not-found"
          ? { kind: "project-not-found" as const }
          : { kind: "project-not-active" as const };

      await expect(
        workflow.checkFeatureForWrite(tx(), {
          cookieHeader: "__Host-session=token",
          projectId: 1,
          moduleId: 2,
          featureId: 3,
        }),
      ).resolves.toEqual(expected);

      expect(calls).toEqual(["session", "project"]);
      expect(modules.checkModuleForWrite).not.toHaveBeenCalled();
      expect(features.checkFeatureForWrite).not.toHaveBeenCalled();
    }
  });

  test("模块 not-found / parent-not-active 会阻断功能检查", async () => {
    const cases: ModuleWriteCheckResult[] = [
      { kind: "not-found" },
      {
        kind: "parent-not-active",
        resource: { ...moduleResource, status: "ARCHIVED" },
      },
    ];

    for (const moduleResult of cases) {
      const { calls, features, workflow } = setup({ module: moduleResult });
      const expected =
        moduleResult.kind === "not-found"
          ? { kind: "module-not-found" as const }
          : { kind: "module-not-active" as const };

      await expect(
        workflow.checkFeatureForWrite(tx(), {
          cookieHeader: "__Host-session=token",
          projectId: 1,
          moduleId: 2,
          featureId: 3,
        }),
      ).resolves.toEqual(expected);

      expect(calls).toEqual(["session", "project", "module"]);
      expect(features.checkFeatureForWrite).not.toHaveBeenCalled();
    }
  });

  test("feature allowed 在模块检查后继续检查功能并返回完整摘要", async () => {
    const { calls, workflow } = setup();
    const context = tx();

    const result = await workflow.checkFeatureForWrite(context, {
      cookieHeader: "__Host-session=token",
      projectId: 1,
      moduleId: 2,
      featureId: 3,
    });

    expect(result).toEqual({
      kind: "allowed",
      actor,
      project,
      module: moduleResource,
      feature: featureResource,
    });
    expect(calls).toEqual(["session", "project", "module", "feature"]);
  });

  test("feature not-found / parent-not-active 保留父级语义并返回 feature 失败", async () => {
    const cases: FeatureWriteCheckResult[] = [
      { kind: "not-found" },
      {
        kind: "parent-not-active",
        resource: { ...featureResource, status: "ARCHIVED" },
      },
    ];

    for (const featureResult of cases) {
      const { workflow } = setup({ feature: featureResult });
      const expected =
        featureResult.kind === "not-found"
          ? { kind: "feature-not-found" as const }
          : { kind: "feature-not-active" as const };

      await expect(
        workflow.checkFeatureForWrite(tx(), {
          cookieHeader: "__Host-session=token",
          projectId: 1,
          moduleId: 2,
          featureId: 3,
        }),
      ).resolves.toEqual(expected);
    }
  });
});
