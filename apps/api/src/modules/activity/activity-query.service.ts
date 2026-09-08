import {
  TimeCursorError,
  TimeCursorService,
  type TimeCursorValue,
} from "../../cursors/time-cursor.js";
import type {
  AuthorizedProjectScope,
  ProjectAccessQueryPort,
} from "../projects/project-access.port.js";
import {
  ACTIVITY_ENTITY_TYPES,
  type ActivityVisibilityScope,
} from "./activity.write-port.js";
import type {
  ActivityProjectionItem,
  ActivityProjectionReader,
} from "./activity-projection.reader.js";

export const ACTIVITY_PAGE_LIMIT_DEFAULT = 20;
export const ACTIVITY_PAGE_LIMIT_MAX = 50;

export interface ActivityQueryCommand {
  readonly actorUserId: number;
  readonly projectId: number;
  readonly includeAdminOnly?: boolean;
  readonly limit?: number;
  readonly after?: string;
}

export interface ActivityQueryPage {
  readonly items: readonly ActivityProjectionItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export class ActivityQueryValidationError extends Error {
  readonly status: "invalid-project" | "invalid-limit" | "invalid-cursor";

  constructor(status: ActivityQueryValidationError["status"], message: string) {
    super(message);
    this.name = "ActivityQueryValidationError";
    this.status = status;
  }
}

export class ActivityAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActivityAuthorizationError";
  }
}

function parseLimit(limit: number | undefined): number {
  const value = limit ?? ACTIVITY_PAGE_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new ActivityQueryValidationError(
      "invalid-limit",
      "limit must be a positive integer",
    );
  }
  return Math.min(value, ACTIVITY_PAGE_LIMIT_MAX);
}

export class ActivityQueryService {
  readonly #projectAccess: ProjectAccessQueryPort;
  readonly #reader: ActivityProjectionReader;
  readonly #cursor: TimeCursorService;

  constructor(
    projectAccess: ProjectAccessQueryPort,
    reader: ActivityProjectionReader,
    cursor: TimeCursorService,
  ) {
    this.#projectAccess = projectAccess;
    this.#reader = reader;
    this.#cursor = cursor;
  }

  async query(command: ActivityQueryCommand): Promise<ActivityQueryPage> {
    if (!Number.isSafeInteger(command.projectId) || command.projectId <= 0) {
      throw new ActivityQueryValidationError(
        "invalid-project",
        "projectId must be a positive integer",
      );
    }
    const scope = await this.#projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    this.assertScope(scope, command.actorUserId, command.projectId);

    const limit = parseLimit(command.limit);
    let after: TimeCursorValue | null;
    try {
      after = this.#cursor.decode(command.after, {
        actorUserId: command.actorUserId,
        namespace: "ACTIVITY",
        projectId: command.projectId,
      });
    } catch (error) {
      if (error instanceof TimeCursorError) {
        throw new ActivityQueryValidationError(
          "invalid-cursor",
          "cursor is invalid, expired, or bound to another project",
        );
      }
      throw error;
    }

    const visibilityScopes: readonly ActivityVisibilityScope[] =
      scope.isSystemAdmin && command.includeAdminOnly === true
        ? ["MEMBER", "ADMIN_ONLY"]
        : ["MEMBER"];
    const page = await this.#reader.read({
      projectId: command.projectId,
      visibilityScopes,
      limit,
      after,
    });
    return {
      items: page.items.map(toWhitelistItem),
      nextCursor:
        page.last === null
          ? null
          : this.#cursor.encode({
              actorUserId: command.actorUserId,
              namespace: "ACTIVITY",
              projectId: command.projectId,
              afterAt: page.last.at,
              afterId: page.last.id,
            }),
      hasMore: page.last !== null,
    };
  }

  private assertScope(
    scope: AuthorizedProjectScope,
    actorUserId: number,
    projectId: number,
  ): void {
    if (scope.actorUserId !== actorUserId) {
      throw new ActivityAuthorizationError(
        "authorization scope actor does not match the request actor",
      );
    }
    if (!scope.projectIds.includes(projectId)) {
      throw new ActivityAuthorizationError(
        "project is not available to the current actor",
      );
    }
  }
}

function toWhitelistItem(item: ActivityProjectionItem): ActivityProjectionItem {
  if (!ACTIVITY_ENTITY_TYPES.includes(item.sourceEntityType)) {
    throw new Error(
      `activity projection contains unsupported entity type ${item.sourceEntityType}`,
    );
  }
  return item;
}
