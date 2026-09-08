import type {
  AuthorizedProjectScope,
  ProjectAccessQueryPort,
} from "../projects/project-access.port.js";
import type {
  SearchProjectionReader,
  SearchProjectionItem,
  SearchProjectionVisibilityScope,
} from "./search-projection.reader.js";
import { SearchCursorError, SearchCursorService } from "./search-cursor.js";
import { validateSearchQuery } from "./search-text.js";

export const SEARCH_PAGE_LIMIT_DEFAULT = 20;
export const SEARCH_PAGE_LIMIT_MAX = 50;

export interface SearchQueryCommand {
  readonly actorUserId: number;
  readonly query: string;
  readonly includeVoid?: boolean;
  readonly limit?: number;
  readonly after?: string;
}

export interface SearchQueryPage {
  readonly items: readonly SearchProjectionItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export class SearchQueryValidationError extends Error {
  readonly status:
    "empty" | "too-short" | "too-long" | "invalid-cursor" | "invalid-limit";

  constructor(status: SearchQueryValidationError["status"], message: string) {
    super(message);
    this.name = "SearchQueryValidationError";
    this.status = status;
  }
}

export class SearchAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchAuthorizationError";
  }
}

function parseLimit(limit: number | undefined): number {
  const value = limit ?? SEARCH_PAGE_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || value < 1) {
    throw new SearchQueryValidationError(
      "invalid-limit",
      "limit must be a positive integer",
    );
  }
  return Math.min(value, SEARCH_PAGE_LIMIT_MAX);
}

function validateScope(
  scope: AuthorizedProjectScope,
  actorUserId: number,
): void {
  if (scope.actorUserId !== actorUserId) {
    throw new SearchAuthorizationError(
      "authorization scope actor does not match the request actor",
    );
  }
}

export class SearchQueryService {
  readonly #projectAccess: ProjectAccessQueryPort;
  readonly #reader: SearchProjectionReader;
  readonly #cursor: SearchCursorService;

  constructor(
    projectAccess: ProjectAccessQueryPort,
    reader: SearchProjectionReader,
    cursor: SearchCursorService,
  ) {
    this.#projectAccess = projectAccess;
    this.#reader = reader;
    this.#cursor = cursor;
  }

  async search(command: SearchQueryCommand): Promise<SearchQueryPage> {
    const validation = validateSearchQuery(command.query);
    if (validation.status !== "ok") {
      throw new SearchQueryValidationError(
        validation.status,
        validation.reason,
      );
    }

    const scope = await this.#projectAccess.getAuthorizedSearchScope(
      command.actorUserId,
    );
    validateScope(scope, command.actorUserId);

    const limit = parseLimit(command.limit);
    let afterId: bigint;
    try {
      afterId = this.#cursor.decode(command.after, {
        actorUserId: command.actorUserId,
        normalizedQuery: validation.normalizedQuery,
      });
    } catch (error) {
      if (error instanceof SearchCursorError) {
        throw new SearchQueryValidationError(
          "invalid-cursor",
          "cursor is invalid, expired, or bound to another request",
        );
      }
      throw error;
    }

    if (scope.projectIds.length === 0) {
      return { items: [], nextCursor: null, hasMore: false };
    }

    const visibilityScopes: readonly SearchProjectionVisibilityScope[] =
      scope.isSystemAdmin && command.includeVoid === true
        ? ["MEMBER", "ADMIN_ONLY"]
        : ["MEMBER"];

    const page = await this.#reader.read({
      normalizedQuery: validation.normalizedQuery,
      projectIds: scope.projectIds,
      visibilityScopes,
      limit,
      afterId,
    });

    return {
      items: page.items,
      nextCursor:
        page.nextAfterId === null
          ? null
          : this.#cursor.encode({
              actorUserId: command.actorUserId,
              normalizedQuery: validation.normalizedQuery,
              afterId: page.nextAfterId,
            }),
      hasMore: page.nextAfterId !== null,
    };
  }
}
