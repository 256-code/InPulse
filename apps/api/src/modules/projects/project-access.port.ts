export const PROJECT_ACCESS_QUERY_PORT = Symbol("PROJECT_ACCESS_QUERY_PORT");

/**
 * Server-generated authorization result. Consumers must never construct this
 * value from client input. The production provider belongs to ProjectsModule
 * and is expected to read member history and the global admin flag on every
 * request.
 */
export interface AuthorizedProjectScope {
  readonly actorUserId: number;
  readonly projectIds: readonly number[];
  readonly isSystemAdmin: boolean;
}

export interface ProjectAccessQueryPort {
  getAuthorizedSearchScope(
    actorUserId: number,
  ): Promise<AuthorizedProjectScope>;
}
