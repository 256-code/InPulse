import { it, expect } from "vitest";
import { leftoverTaskRequestSchema } from "../src/contracts/leftover-task.zod.js";
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
