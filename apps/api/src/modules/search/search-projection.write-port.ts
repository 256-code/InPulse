import type { TransactionContext } from "../../database/transaction-context.js";
import { normalizeSearchText } from "./search-text.js";
import {
  SEARCH_PROJECTION_ENTITY_TYPES,
  SEARCH_PROJECTION_VISIBILITY_SCOPES,
  type SearchProjectionEntityType,
  type SearchProjectionVisibilityScope,
} from "./search-projection.types.js";

const SEARCH_TITLE_MAX_LENGTH = 500;
const SEARCH_SUMMARY_MAX_LENGTH = 5_000;
const SEARCH_TEXT_MAX_LENGTH = 100_000;
const SEARCH_STATUS_MAX_LENGTH = 50;

export interface SearchProjectionWriteInput {
  readonly projectId: number;
  readonly entityType: SearchProjectionEntityType;
  readonly entityId: number;
  readonly title: string;
  readonly summary: string;
  readonly rawText: string;
  readonly visibilityScope: SearchProjectionVisibilityScope;
  readonly sourceStatus: string;
  readonly sourceRowVersion: number;
}

export class SearchProjectionWriteValidationError extends Error {
  readonly code = "SEARCH_PROJECTION_WRITE_VALIDATION_ERROR" as const;

  constructor(readonly reason: string) {
    super(reason);
    this.name = "SearchProjectionWriteValidationError";
  }
}

/** 搜索投影维护边界：调用方持有事务并负责脱敏，本 Port 只规范化和 upsert。 */
export abstract class SearchProjectionWritePort {
  abstract upsert(
    tx: TransactionContext,
    input: SearchProjectionWriteInput,
  ): Promise<void>;
}

export function validateSearchProjectionWriteInput(
  input: SearchProjectionWriteInput,
): string {
  if (!Number.isSafeInteger(input.projectId) || input.projectId <= 0) {
    invalid("projectId must be a positive integer");
  }
  if (!Number.isSafeInteger(input.entityId) || input.entityId <= 0) {
    invalid("entityId must be a positive integer");
  }
  if (!SEARCH_PROJECTION_ENTITY_TYPES.includes(input.entityType)) {
    invalid("entityType is not supported");
  }
  if (!SEARCH_PROJECTION_VISIBILITY_SCOPES.includes(input.visibilityScope)) {
    invalid("visibilityScope is not supported");
  }
  if (
    input.title.trim().length === 0 ||
    input.title.length > SEARCH_TITLE_MAX_LENGTH
  ) {
    invalid("title must contain 1 to 500 characters");
  }
  if (input.summary.length > SEARCH_SUMMARY_MAX_LENGTH) {
    invalid("summary exceeds 5000 characters");
  }
  if (
    input.rawText.length === 0 ||
    input.rawText.length > SEARCH_TEXT_MAX_LENGTH
  ) {
    invalid("rawText must contain 1 to 100000 characters");
  }
  if (
    input.sourceStatus.trim().length === 0 ||
    input.sourceStatus.length > SEARCH_STATUS_MAX_LENGTH
  ) {
    invalid("sourceStatus must contain 1 to 50 characters");
  }
  if (
    !Number.isSafeInteger(input.sourceRowVersion) ||
    input.sourceRowVersion <= 0
  ) {
    invalid("sourceRowVersion must be a positive integer");
  }

  const normalized = normalizeSearchText(input.rawText);
  if (normalized.length === 0 || normalized.length > SEARCH_TEXT_MAX_LENGTH) {
    invalid("rawText must produce non-empty normalized search text");
  }
  return normalized;
}

function invalid(reason: string): never {
  throw new SearchProjectionWriteValidationError(reason);
}

/** User-visible capacity failure caused by combining current text and linked evidence. */
export class SearchProjectionCapacityError extends Error {
  readonly status = 422;
  readonly code = "SEARCH_TEXT_CAPACITY_EXCEEDED";
  constructor() {
    super("正文与GitHub链接的搜索内容超过容量，请精简正文或解除不需要的链接");
  }
}
