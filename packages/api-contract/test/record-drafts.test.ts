import { describe, expect, it } from "vitest";
import { schemaRegistry } from "../src/schema-registry.js";
import {
  recordDraftContentSchema,
  independentRecordDraftSchema,
} from "../src/contracts/record-drafts.zod.js";

const content = {
  title: " 支付重试验证 ",
  contextProblem: " 发现重复提交 ",
  changeSolution: "增加请求去重",
  resultVerification: "并发回归通过",
  remainingIssues: "",
};
describe("F-17 draft content", () => {
  it("lets the server derive the source title and rejects client-owned identity or state fields", () => {
    const schema = schemaRegistry.TaskRecordDraftRequest.schema;
    expect(schema.parse({ ...content, title: null }).title).toBeNull();
    for (const field of [
      "taskId",
      "projectId",
      "moduleId",
      "featureId",
      "impactFeatureIds",
      "handlerId",
      "authorId",
      "status",
      "createdAt",
    ])
      expect(
        schema.safeParse({ ...content, title: null, [field]: 1 }).success,
      ).toBe(false);
    for (const field of [
      "contextProblem",
      "changeSolution",
      "resultVerification",
    ])
      expect(
        schema.safeParse({ ...content, title: null, [field]: " " }).success,
      ).toBe(false);
  });
  it("requires the three core sections and normalizes user content", () => {
    expect(recordDraftContentSchema.parse(content)).toMatchObject({
      title: "支付重试验证",
      contextProblem: "发现重复提交",
      remainingIssues: "",
    });
    for (const field of [
      "title",
      "contextProblem",
      "changeSolution",
      "resultVerification",
    ])
      expect(
        recordDraftContentSchema.safeParse({ ...content, [field]: "  " })
          .success,
      ).toBe(false);
    for (const field of [
      "taskId",
      "authorId",
      "handlerId",
      "status",
      "code",
      "currentVersion",
      "publishedAt",
    ])
      expect(
        recordDraftContentSchema.safeParse({ ...content, [field]: 1 }).success,
      ).toBe(false);
  });
  it("requires one explicit independent scope and deduplicates module impacts", () => {
    expect(
      independentRecordDraftSchema.parse({
        ...content,
        scopeType: "MODULE",
        impactFeatureIds: [4, 3, 4],
      }),
    ).toMatchObject({ impactFeatureIds: [3, 4] });
    expect(
      independentRecordDraftSchema.safeParse({
        ...content,
        scopeType: "FEATURE",
        featureId: 2,
      }).success,
    ).toBe(true);
    expect(
      independentRecordDraftSchema.safeParse({
        ...content,
        scopeType: "FEATURE",
        featureId: 2,
        impactFeatureIds: [3],
      }).success,
    ).toBe(false);
    expect(
      independentRecordDraftSchema.safeParse({
        ...content,
        scopeType: "MODULE",
        featureId: 2,
        impactFeatureIds: [],
      }).success,
    ).toBe(false);
    expect(
      independentRecordDraftSchema.safeParse({
        ...content,
        scopeType: "MODULE",
        impactFeatureIds: [0],
      }).success,
    ).toBe(false);
  });
});
