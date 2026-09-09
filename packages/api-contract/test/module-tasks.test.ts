import { describe, expect, it } from "vitest";
import {
  moduleTaskEditRequestSchema,
  moduleTaskItemSchema,
} from "../src/contracts/tasks.zod.js";

describe("F-15 module task contract", () => {
  it("normalizes the influence set and permits an empty scope", () => {
    const input = {
      title: "公共支付",
      description: "",
      priority: "NORMAL",
      assigneeId: 1,
      dueAt: null,
      impactFeatureIds: [3, 2, 3],
    };
    expect(moduleTaskEditRequestSchema.parse(input).impactFeatureIds).toEqual([
      2, 3,
    ]);
    expect(
      moduleTaskEditRequestSchema.parse({ ...input, impactFeatureIds: [] })
        .impactFeatureIds,
    ).toEqual([]);
    expect(
      moduleTaskEditRequestSchema.safeParse({ ...input, featureId: 2 }).success,
    ).toBe(false);
    expect(
      moduleTaskEditRequestSchema.safeParse({ ...input, impactFeatureIds: [0] })
        .success,
    ).toBe(false);
  });
  it("cannot describe a MODULE task with a direct feature owner", () => {
    expect(
      moduleTaskItemSchema.safeParse({ scopeType: "MODULE", featureId: 1 })
        .success,
    ).toBe(false);
  });
});
