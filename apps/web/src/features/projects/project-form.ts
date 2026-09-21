import { z } from "zod";
import type { CreateProjectRequest } from "@generated/api";

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_CODE_MAX_LENGTH = 32;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 20_000;
export const PROJECT_CARD_SHORTNAME_LENGTH = 3;

const projectCodePattern = /^[A-Z][A-Z0-9_]{1,31}$/;

export const projectFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入项目名称")
    .max(
      PROJECT_NAME_MAX_LENGTH,
      `项目名称不能超过 ${PROJECT_NAME_MAX_LENGTH} 个字符`,
    ),
  code: z
    .string()
    .trim()
    .min(2, "项目编码至少需要 2 个字符")
    .max(
      PROJECT_CODE_MAX_LENGTH,
      `项目编码不能超过 ${PROJECT_CODE_MAX_LENGTH} 个字符`,
    )
    .regex(
      projectCodePattern,
      "项目编码需为 2-32 位大写字母、数字或下划线，且以字母开头",
    ),
  description: z
    .string()
    .trim()
    .max(
      PROJECT_DESCRIPTION_MAX_LENGTH,
      `项目描述不能超过 ${PROJECT_DESCRIPTION_MAX_LENGTH} 个字符`,
    ),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

export const PROJECT_ARCHIVE_REASON_MAX_LENGTH = 2000;

/** 项目编辑只允许整笔替换名称与描述；编码创建后不可修改。 */
export const projectEditFormSchema = projectFormSchema.pick({
  name: true,
  description: true,
});

export type ProjectEditFormValues = z.infer<typeof projectEditFormSchema>;

/** 归档与恢复都必须由管理员显式填写原因。 */
export const projectArchiveFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "请填写归档原因")
    .max(
      PROJECT_ARCHIVE_REASON_MAX_LENGTH,
      `归档原因不能超过 ${PROJECT_ARCHIVE_REASON_MAX_LENGTH} 个字符`,
    ),
});

export const projectRestoreFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "请填写恢复原因")
    .max(
      PROJECT_ARCHIVE_REASON_MAX_LENGTH,
      `恢复原因不能超过 ${PROJECT_ARCHIVE_REASON_MAX_LENGTH} 个字符`,
    ),
});

export type ProjectArchiveFormValues = z.infer<typeof projectArchiveFormSchema>;

/** ADR-034：驳回归档申请的批注可选，留空表示不附理由。 */
export const PROJECT_ARCHIVE_NOTE_MAX_LENGTH = 2000;

export const projectArchiveRejectionFormSchema = z.object({
  note: z
    .string()
    .trim()
    .max(
      PROJECT_ARCHIVE_NOTE_MAX_LENGTH,
      `批注不能超过 ${PROJECT_ARCHIVE_NOTE_MAX_LENGTH} 个字符`,
    ),
});

export type ProjectArchiveRejectionFormValues = z.infer<
  typeof projectArchiveRejectionFormSchema
>;

export type ProjectRestoreFormValues = z.infer<typeof projectRestoreFormSchema>;

export function normalizeProjectCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * 从名称自动推导项目编码：只取其中的英文与数字，中文、空格与符号作为分隔丢弃。
 * 推导结果不满足编码规则时返回空串，避免自动写入无法提交的值，改由用户手填。
 */
export function deriveProjectCodeFromName(name: string): string {
  const candidate = name
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, PROJECT_CODE_MAX_LENGTH);
  return projectCodePattern.test(candidate) ? candidate : "";
}

export function deriveProjectCardShortname(code: string): string {
  const normalized = normalizeProjectCode(code);
  return normalized.slice(0, PROJECT_CARD_SHORTNAME_LENGTH) || "—";
}

export function toCreateProjectRequest(
  values: ProjectFormValues,
  selectedMemberIds: readonly number[] = [],
): CreateProjectRequest {
  return {
    name: values.name,
    code: values.code,
    description: values.description,
    memberIds: Array.from(
      new Set(
        selectedMemberIds.filter(
          (memberId) => Number.isSafeInteger(memberId) && memberId > 0,
        ),
      ),
    ).sort((left, right) => left - right),
  };
}
