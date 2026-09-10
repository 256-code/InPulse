import { expect, it } from "vitest";
import { schemaRegistry } from "../src/schema-registry.js";
import { routeRegistry } from "../src/route-registry.js";
it("registers typed targets and versioned link mutations", () => {
  const schemas = schemaRegistry as Record<
    string,
    { schema: { safeParse(value: unknown): { success: boolean } } }
  >;
  expect(schemas.ExternalLinkTargetPath).toBeDefined();
  expect(
    schemas.ExternalLinkTargetPath!.schema.safeParse({
      targetType: "TASK",
      targetId: "1",
    }).success,
  ).toBe(true);
  expect(
    schemas.ExternalLinkTargetPath!.schema.safeParse({
      targetType: "MODULE",
      targetId: "1",
    }).success,
  ).toBe(false);
  for (const name of ["addExternalLink", "removeExternalLink"]) {
    expect(routeRegistry.find((r) => r.operationId === name)).toMatchObject({
      idempotencyPolicy: "idempotencyRequired",
      behaviorHeaders: ["If-Match"],
      versionPolicy: { ifMatch: "required" },
    });
  }
  expect(
    routeRegistry.find((r) => r.operationId === "listExternalLinks")?.method,
  ).toBe("GET");
});
