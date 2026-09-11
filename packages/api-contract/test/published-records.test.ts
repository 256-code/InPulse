import { describe, expect, it } from "vitest";
import { schemaRegistry } from "../src/schema-registry.js";
const content = {
  title: "修订",
  contextProblem: "问题",
  changeSolution: "方案",
  resultVerification: "验证",
  remainingIssues: "",
  confirmLeftoverResolved: false,
};
it("limits formal leftovers without changing draft capacity and rejects identity mutation", () => {
  const schema = schemaRegistry.PublishedRecordContent.schema;
  expect(
    schema.safeParse({ ...content, remainingIssues: "文".repeat(10000) })
      .success,
  ).toBe(true);
  expect(
    schema.safeParse({ ...content, remainingIssues: "文".repeat(10001) })
      .success,
  ).toBe(false);
  const { confirmLeftoverResolved, ...draft } = content;
  expect(
    schemaRegistry.RecordDraftContent.schema.safeParse({
      ...draft,
      remainingIssues: "文".repeat(50000),
    }).success,
  ).toBe(true);
  expect(schema.safeParse(draft).success).toBe(false);
  for (const field of [
    "taskId",
    "projectId",
    "moduleId",
    "handlerId",
    "authorId",
    "status",
    "currentVersion",
    "leftoverItem",
  ])
    expect(schema.safeParse({ ...content, [field]: 1 }).success).toBe(false);
  expect(confirmLeftoverResolved).toBe(false);
});
it("requires both explicit version headers and a strictly empty publication body", () => {
  const headers = {
    "x-csrf-token": "a".repeat(43),
    "if-match": '"2"',
    "x-record-version": "1",
  };
  expect(
    schemaRegistry.PublishedRecordVersionHeaders.schema.safeParse(headers)
      .success,
  ).toBe(true);
  for (const name of ["if-match", "x-record-version"])
    expect(
      schemaRegistry.PublishedRecordVersionHeaders.schema.safeParse({
        ...headers,
        [name]: undefined,
      }).success,
    ).toBe(false);
  expect(schemaRegistry.PublishRecordRequest.schema.safeParse({}).success).toBe(
    true,
  );
  expect(
    schemaRegistry.PublishRecordRequest.schema.safeParse({ taskId: 1 }).success,
  ).toBe(false);
});

describe("B-1 published record list pagination contract", () => {
  it("accepts status/cursor/limit and rejects unknown or out-of-range values", () => {
    const schema = schemaRegistry.RecordListQuery.schema;
    expect(schema.parse({ status: "VOID", limit: "20" })).toEqual({
      status: "VOID",
      limit: 20,
    });
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ cursor: "" }).success).toBe(false);
    expect(schema.safeParse({ q: "x" }).success).toBe(false);
  });
  it("keeps the items/nextCursor/hasMore envelope strict", () => {
    const page = schemaRegistry.ReadableRecordPage.schema;
    expect(
      page.safeParse({ items: [], nextCursor: "c.1", hasMore: true }).success,
    ).toBe(true);
    expect(page.safeParse({ items: [], hasMore: true }).success).toBe(false);
  });
});
