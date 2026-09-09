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

export function normalizeProjectCode(value: string): string {
  return value.trim().toUpperCase();
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
