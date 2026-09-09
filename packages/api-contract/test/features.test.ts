import { describe, expect, it } from "vitest";
import {
  featureEditRequestSchema,
  featureResourcePathSchema,
} from "../src/contracts/features.zod.js";
import { routeRegistry } from "../src/route-registry.js";

describe("F-13 feature contract", () => {
  it("accepts duplicate names but rejects identity injection and field overflow", () => {
    expect(featureEditRequestSchema.parse({ name: "  支付  " })).toEqual({
      name: "支付",
      currentBehavior: "",
      tags: [],
    });
    for (const extra of [
      { code: "SHOP-F-1" },
      { projectId: 1 },
      { moduleId: 1 },
      { createdBy: 1 },
      { status: "ARCHIVED" },
    ])
      expect(
        featureEditRequestSchema.safeParse({ name: "支付", ...extra }).success,
      ).toBe(false);
    for (const invalid of [
      { name: " " },
      { name: "x".repeat(501) },
      { name: "x", currentBehavior: "x".repeat(50001) },
      { name: "x", tags: Array(51).fill("x") },
    ])
      expect(featureEditRequestSchema.safeParse(invalid).success).toBe(false);
    expect(
      featureResourcePathSchema.safeParse({
        projectId: 1,
        moduleId: 2,
        featureId: 3,
      }).success,
    ).toBe(true);
  });
  it("registers all seven operations with explicit write/replay/version policies", () => {
    const operations = [
      "listFeatures",
      "getFeature",
      "findSimilarFeatures",
      "createFeature",
      "updateFeature",
      "archiveFeature",
      "restoreFeature",
    ];
    for (const operation of operations) {
      const route = routeRegistry.find((r) => r.operationId === operation);
      expect(route).toBeDefined();
      if (route?.method === "GET") expect(route.idempotencyPolicy).toBe("none");
      else {
        expect(route?.idempotencyPolicy).toBe("idempotencyRequired");
        expect(route?.replayAuthorizationPolicy).not.toBe("none");
        if (operation !== "createFeature")
          expect(route?.behaviorHeaders).toContain("If-Match");
      }
    }
  });
});
