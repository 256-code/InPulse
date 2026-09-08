import type { TransactionContext } from "../../database/transaction-context.js";

export interface NotificationWriteInput {
  readonly recipientId: number;
  readonly projectId: number | null;
  readonly sourceChainId: string;
  readonly sourceSequence: number;
  readonly notificationType: string;
  readonly title: string;
  readonly body: string;
  readonly targetPath: string | null;
  readonly createdAt: Date;
}

export interface NotificationWriteResult {
  readonly inserted: boolean;
}

export class NotificationWriteValidationError extends Error {
  readonly code = "NOTIFICATION_WRITE_VALIDATION_ERROR" as const;

  constructor(readonly reason: string) {
    super(reason);
    this.name = "NotificationWriteValidationError";
  }
}

/**
 * 站内通知写边界。接收方必须由业务 Workflow 按服务端场景计算，
 * Port 拒绝客户端传入的 recipient 概念；数据库唯一约束防止同一来源事件重复。
 */
export abstract class NotificationWritePort {
  abstract write(
    tx: TransactionContext,
    input: NotificationWriteInput,
  ): Promise<NotificationWriteResult>;
}

export function validateNotificationWriteInput(
  input: NotificationWriteInput,
): void {
  if (!positiveInteger(input.recipientId)) {
    invalid("recipientId must be a positive integer");
  }
  if (input.projectId !== null && !positiveInteger(input.projectId)) {
    invalid("projectId must be null or a positive integer");
  }
  const expectedChain =
    input.projectId === null ? "SYSTEM" : `PROJECT:${input.projectId}`;
  if (input.sourceChainId !== expectedChain) {
    invalid("sourceChainId must match the notification project scope");
  }
  if (!positiveInteger(input.sourceSequence)) {
    invalid("sourceSequence must be a positive integer");
  }
  if (
    input.notificationType.trim().length === 0 ||
    input.notificationType.length > 100
  ) {
    invalid("notificationType must contain 1 to 100 characters");
  }
  if (input.title.trim().length === 0 || input.title.length > 500) {
    invalid("title must contain 1 to 500 characters");
  }
  if (input.body.length > 5000) {
    invalid("body cannot exceed 5000 characters");
  }
  if (
    input.targetPath !== null &&
    (input.targetPath.length === 0 ||
      input.targetPath.length > 2048 ||
      !input.targetPath.startsWith("/"))
  ) {
    invalid(
      "targetPath must be a root-relative path no longer than 2048 characters",
    );
  }
  if (!Number.isFinite(input.createdAt.getTime())) {
    invalid("createdAt must be a valid date");
  }
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function invalid(reason: string): never {
  throw new NotificationWriteValidationError(reason);
}
