import { expect, it } from "vitest";
import { schemaRegistry } from "../src/schema-registry.js";
import { routeRegistry } from "../src/route-registry.js";
it("requires a trimmed reason and rejects client lifecycle fields", () => {
  const schema = schemaRegistry.RecordLifecycleRequest.schema;
  expect(schema.parse({ reason: "  误操作  " })).toEqual({ reason: "误操作" });
  for (const body of [
    {},
    { reason: " \n " },
    { reason: "恢复", status: "PUBLISHED" },
    { reason: "恢复", taskId: 1 },
  ])
    expect(schema.safeParse(body).success).toBe(false);
});
it("registers high risk lifecycle commands and minimal safe replay", () => {
  for (const operationId of ["voidChangeRecord", "restoreChangeRecord"]) {
    const route = routeRegistry.find((r) => r.operationId === operationId)!;
    expect(route).toMatchObject({
      authPolicy: "adminSessionWithReauthentication",
      idempotencyPolicy: "idempotencyRequired",
      csrfPolicy: "required",
      behaviorHeaders: ["If-Match"],
    });
    expect(route.idempotencyReplayPolicy).toMatchObject({
      success: {
        "200": {
          body: {
            responseSchemaRef: "RecordLifecycleResult",
            safeBodyFieldPaths: ["id", "projectId", "status", "rowVersion"],
          },
        },
      },
    });
  }
});
