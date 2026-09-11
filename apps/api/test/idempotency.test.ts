import { describe, expect, test } from "vitest";

import {
  buildIdempotencyDigest,
  idempotencyDigestFormat,
} from "../src/idempotency/digest";

describe("buildIdempotencyDigest", () => {
  const hmacMaterial = "test-versioned-material";
  const base = {
    method: "POST",
    operationId: "createProject",
    idempotencyContractVersion: "1",
    digestFormat: idempotencyDigestFormat,
    requestSchemaVersion: "1",
    pathParams: { projectId: "42" },
    query: { expand: "members" },
    contentType: "application/json",
    behaviorHeaders: { "x-idempotent": "1" },
    body: { name: "demo", members: [{ id: 1 }] },
    ifMatch: undefined,
  };

  test("同一输入与密钥产生稳定摘要", () => {
    const first = buildIdempotencyDigest(base, hmacMaterial);
    const second = buildIdempotencyDigest(base, hmacMaterial);
    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  test("字段顺序不影响摘要", () => {
    const reordered = buildIdempotencyDigest(
      {
        ...base,
        body: { members: [{ id: 1 }], name: "demo" },
        query: { expand: "members" },
      },
      hmacMaterial,
    );
    expect(reordered).toBe(buildIdempotencyDigest(base, hmacMaterial));
  });

  test("不同密钥产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(base, "other-versioned-material"),
    );
  });

  test("语义输入变化产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, idempotencyContractVersion: "2" },
        hmacMaterial,
      ),
    );
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, body: { name: "other" } },
        hmacMaterial,
      ),
    );
  });

  test("行为相关请求头变化产生不同摘要", () => {
    expect(buildIdempotencyDigest(base, hmacMaterial)).not.toBe(
      buildIdempotencyDigest(
        { ...base, behaviorHeaders: { "x-idempotent": "2" } },
        hmacMaterial,
      ),
    );
  });

  test("If-Match 存在与否不同摘要；存在时纳入摘要", () => {
    const withIfMatch = buildIdempotencyDigest(
      { ...base, ifMatch: '"abc"' },
      hmacMaterial,
    );
    expect(withIfMatch).not.toBe(buildIdempotencyDigest(base, hmacMaterial));
    expect(withIfMatch).toBe(
      buildIdempotencyDigest({ ...base, ifMatch: '"abc"' }, hmacMaterial),
    );
  });
});
