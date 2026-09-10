import { expect, it } from "vitest";
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
