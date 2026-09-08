import { Inject, Injectable } from "@nestjs/common";

import {
  SessionAuthService,
  type AuthenticatedSessionActor,
} from "../auth/session-auth.service.js";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
  type ProjectForWriteResource,
} from "../modules/projects/index.js";
import {
  ModuleQueryPort,
  type ModuleForWriteResource,
} from "../modules/modules/index.js";
import {
  FeatureQueryPort,
  type FeatureForWriteResource,
} from "../modules/features/index.js";

/**
 * Workflow 层复用的父级写前检查编排。
 *
 * 只负责在调用方已经持有的事务中解析 Session actor，并按
 * 项目 -> 模块 -> 功能 的顺序取得对应行的 FOR SHARE；业务写入与归档操作
 * 不在此处实现。任意一层返回 `not-found` / `parent-not-active` 时，
 * 后续 Port 不得被调用，调用方也不应继续业务写入。
 */

export type ProjectWriteAccessStep =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "project-not-found" }
  | { readonly kind: "project-not-active" }
  | {
      readonly kind: "allowed";
      readonly actor: AuthenticatedSessionActor;
      readonly project: ProjectForWriteResource;
    };

export type ModuleWriteAccessFailure =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "project-not-found" }
  | { readonly kind: "project-not-active" }
  | { readonly kind: "module-not-found" }
  | { readonly kind: "module-not-active" };

export type ModuleWriteAccessResult =
  | ModuleWriteAccessFailure
  | {
      readonly kind: "allowed";
      readonly actor: AuthenticatedSessionActor;
      readonly project: ProjectForWriteResource;
      readonly module: ModuleForWriteResource;
    };

export type FeatureWriteAccessFailure =
  | ModuleWriteAccessFailure
  | { readonly kind: "feature-not-found" }
  | { readonly kind: "feature-not-active" };

export type FeatureWriteAccessResult =
  | FeatureWriteAccessFailure
  | {
      readonly kind: "allowed";
      readonly actor: AuthenticatedSessionActor;
      readonly project: ProjectForWriteResource;
      readonly module: ModuleForWriteResource;
      readonly feature: FeatureForWriteResource;
    };

export interface CheckModuleForWriteInput {
  readonly cookieHeader: string | undefined;
  readonly projectId: number;
  readonly moduleId: number;
}

export interface CheckFeatureForWriteInput extends CheckModuleForWriteInput {
  readonly featureId: number;
}

@Injectable()
export class ProjectWriteAccessWorkflow {
  constructor(
    @Inject(SessionAuthService)
    private readonly sessionAuth: SessionAuthService,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly projectAccess: ProjectAccessQueryPort,
    @Inject(ModuleQueryPort)
    private readonly modules: ModuleQueryPort,
    @Inject(FeatureQueryPort)
    private readonly features: FeatureQueryPort,
  ) {}

  async checkModuleForWrite(
    tx: TransactionContext,
    input: CheckModuleForWriteInput,
  ): Promise<ModuleWriteAccessResult> {
    const project = await this.resolveProjectAccess(
      tx,
      input.cookieHeader,
      input.projectId,
    );
    if (project.kind !== "allowed") {
      return project;
    }

    const module = await this.modules.checkModuleForWrite(tx, {
      projectId: input.projectId,
      moduleId: input.moduleId,
    });
    if (module.kind === "not-found") {
      return { kind: "module-not-found" };
    }
    if (module.kind === "parent-not-active") {
      return { kind: "module-not-active" };
    }

    return {
      kind: "allowed",
      actor: project.actor,
      project: project.project,
      module: module.resource,
    };
  }

  async checkFeatureForWrite(
    tx: TransactionContext,
    input: CheckFeatureForWriteInput,
  ): Promise<FeatureWriteAccessResult> {
    const module = await this.checkModuleForWrite(tx, input);
    if (module.kind !== "allowed") {
      return module;
    }

    const feature = await this.features.checkFeatureForWrite(tx, {
      projectId: input.projectId,
      moduleId: input.moduleId,
      featureId: input.featureId,
    });
    if (feature.kind === "not-found") {
      return { kind: "feature-not-found" };
    }
    if (feature.kind === "parent-not-active") {
      return { kind: "feature-not-active" };
    }

    return {
      kind: "allowed",
      actor: module.actor,
      project: module.project,
      module: module.module,
      feature: feature.resource,
    };
  }

  private async resolveProjectAccess(
    tx: TransactionContext,
    cookieHeader: string | undefined,
    projectId: number,
  ): Promise<ProjectWriteAccessStep> {
    const actor = await this.sessionAuth.resolveActorInTransaction(
      tx,
      cookieHeader,
    );
    if (actor === undefined) {
      return { kind: "unauthenticated" };
    }

    const project = await this.projectAccess.checkProjectForWrite(tx, {
      actorUserId: actor.userId,
      projectId,
    });
    if (project.kind === "not-found") {
      return { kind: "project-not-found" };
    }
    if (project.kind === "parent-not-active") {
      return { kind: "project-not-active" };
    }

    return {
      kind: "allowed",
      actor,
      project: project.resource,
    };
  }
}
