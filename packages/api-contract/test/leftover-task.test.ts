import { it, expect } from "vitest";
import {
  leftoverTaskRequestSchema,
  leftoverTaskPreviewQuerySchema,
} from "../src/contracts/leftover-task.zod.js";
const input = {
  leftoverItemId: 1,
  recordVersion: 2,
  expectedRowVersion: 3,
  leftoverExpectedRowVersion: 1,
  expectedImpactFeatureIds: [4],
  title: "跟进",
  assigneeId: 5,
  priority: "NORMAL",
  dueAt: null,
};
it("requires stable item, current record and item versions and explicit impact confirmation", () => {
  expect(leftoverTaskRequestSchema.safeParse(input).success).toBe(true);
  for (const body of [
    { ...input, leftoverItemId: 0 },
    { ...input, recordVersion: 0 },
    { ...input, expectedImpactFeatureIds: [4, 4] },
    { ...input, projectId: 10 },
    { ...input, description: "覆盖原文" },
    { ...input, workStatus: "DONE" },
    { ...input, assigneeId: 0 },
  ])
    expect(leftoverTaskRequestSchema.safeParse(body).success).toBe(false);
});
it("preview query either names one leftover item or omits it for multi-entry records", () => {
  expect(leftoverTaskPreviewQuerySchema.parse({ leftoverItemId: "7" })).toEqual(
    { leftoverItemId: 7 },
  );
  expect(leftoverTaskPreviewQuerySchema.parse({})).toEqual({});
  for (const query of [
    { leftoverItemId: 0 },
    { leftoverItemId: "x" },
    { leftoverItemId: 1.5 },
    { leftoverItemId: null },
    { recordVersion: 1 },
  ])
    expect(leftoverTaskPreviewQuerySchema.safeParse(query).success).toBe(false);
});
