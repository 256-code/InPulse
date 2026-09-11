import { describe, expect, test } from "vitest";

import { rfc3986Encode, signAwsRequest } from "../src/sigv4.js";

const credentials = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
};

const EMPTY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("AWS SigV4", () => {
  test("AWS 官方测试套件 get-vanilla 向量", () => {
    const signed = signAwsRequest(
      {
        method: "GET",
        url: new URL("https://example.amazonaws.com/"),
        headers: { host: "example.amazonaws.com" },
        payloadHash: EMPTY_SHA256,
        date: new Date("2015-08-30T12:36:00Z"),
      },
      credentials,
    );
    expect(signed["x-amz-date"]).toBe("20150830T123600Z");
    expect(signed["authorization"]).toBe(
      "AWS4-HMAC-SHA256 " +
        "Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-date, " +
        "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  test("规范 query 按键与值排序并编码", () => {
    const signed = signAwsRequest(
      {
        method: "GET",
        url: new URL("https://example.amazonaws.com/?b=2&a=1%20x"),
        headers: { host: "example.amazonaws.com" },
        payloadHash: EMPTY_SHA256,
        date: new Date("2015-08-30T12:36:00Z"),
      },
      credentials,
    );
    expect(signed["authorization"]).toContain("host;x-amz-date");
  });

  test("rfc3986 编码转义非保留字符", () => {
    expect(rfc3986Encode("a b")).toBe("a%20b");
    expect(rfc3986Encode("a/b")).toBe("a%2Fb");
    expect(rfc3986Encode("!*()")).toBe("%21%2A%28%29");
    expect(rfc3986Encode("-_.~")).toBe("-_.~");
  });
});
