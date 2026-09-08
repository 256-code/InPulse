export const MIN_QUERY_LENGTH = 2;

// 与 packages/api-contract 的 SearchQueryRequest 保持一致；契约变更必须同步此处。
export const MAX_QUERY_LENGTH = 200;

export type SearchQueryValidationStatus =
  "ok" | "empty" | "too-short" | "too-long";

export interface SearchQueryValidation {
  readonly ok: boolean;
  readonly status: SearchQueryValidationStatus;
  readonly rawLength: number;
  readonly normalizedLength: number;
  readonly normalizedQuery: string;
  readonly reason: string;
}

const punctuationMap: Readonly<Record<string, string>> = {
  "，": ",",
  "。": ".",
  "！": "!",
  "？": "?",
  "；": ";",
  "：": ":",
  "、": ",",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "｛": "{",
  "｝": "}",
  "《": "<",
  "》": ">",
  "「": "[",
  "」": "]",
  "『": "[",
  "』": "]",
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "–": "-",
  "—": "-",
  "－": "-",
  "・": ".",
  "～": "~",
  "＿": "_",
};

export function normalizeSearchText(input: string): string {
  const normalized = input.normalize("NFKC").toLowerCase();
  return Array.from(
    normalized,
    (character) => punctuationMap[character] ?? character,
  )
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
}

export function validateSearchQuery(rawQuery: string): SearchQueryValidation {
  const rawLength = rawQuery.length;
  if (rawLength === 0) {
    return {
      ok: false,
      status: "empty",
      rawLength,
      normalizedLength: 0,
      normalizedQuery: "",
      reason: "query is empty",
    };
  }
  if (rawLength > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      status: "too-long",
      rawLength,
      normalizedLength: 0,
      normalizedQuery: "",
      reason: `query exceeds ${MAX_QUERY_LENGTH} characters`,
    };
  }

  const normalizedQuery = normalizeSearchText(rawQuery);
  if (normalizedQuery.length === 0) {
    return {
      ok: false,
      status: "empty",
      rawLength,
      normalizedLength: 0,
      normalizedQuery,
      reason: "query is empty after normalization",
    };
  }
  if (normalizedQuery.length < MIN_QUERY_LENGTH) {
    return {
      ok: false,
      status: "too-short",
      rawLength,
      normalizedLength: normalizedQuery.length,
      normalizedQuery,
      reason: `query must contain at least ${MIN_QUERY_LENGTH} characters`,
    };
  }

  return {
    ok: true,
    status: "ok",
    rawLength,
    normalizedLength: normalizedQuery.length,
    normalizedQuery,
    reason: "ok",
  };
}
