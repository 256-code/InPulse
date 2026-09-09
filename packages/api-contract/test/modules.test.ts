import { describe, expect, it } from "vitest";
import {
  moduleEditRequestSchema,
  moduleVersionHeadersSchema,
  moduleArchiveRequestSchema,
} from "../src/contracts/modules.zod.js";

describe("F-12 request boundaries", () => {
  it("rejects client-controlled identity and blank or oversized fields", () => {
    for (const input of [
      { name: " ", description: "" },
      { name: "a", kind: "UNCLASSIFIED" },
      { name: "a", projectId: 2 },
      { name: "a", description: "x".repeat(20001) },
    ]) {
      expect(moduleEditRequestSchema.safeParse(input).success).toBe(false);
    }
    expect(moduleEditRequestSchema.parse({ name: "  新分类  " })).toEqual({
      name: "新分类",
      description: "",
    });
  });
  it("requires a quoted positive If-Match and a nonempty archive reason", () => {
    for (const value of [undefined, "1", '"0"', '"-1"', "*"]) {
      expect(
        moduleVersionHeadersSchema.safeParse({
          "if-match": value,
          "x-csrf-token": "a".repeat(43),
        }).success,
      ).toBe(false);
    }
    expect(
      moduleVersionHeadersSchema.safeParse({
        "if-match": '"2"',
        "x-csrf-token": "a".repeat(43),
      }).success,
    ).toBe(true);
    expect(moduleArchiveRequestSchema.safeParse({ reason: " " }).success).toBe(
      false,
    );
  });
});
