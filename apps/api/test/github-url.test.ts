import { describe, expect, test } from "vitest";

import {
  InvalidGitHubUrlError,
  normalizeGitHubUrl,
} from "../src/modules/external-links/github-url.js";

describe("normalizeGitHubUrl", () => {
  test("接受并规范化 GitHub 仓库、Issue、PR 与 Commit 链接", () => {
    expect(normalizeGitHubUrl("https://github.com/inpulse/core")).toEqual({
      displayUrl: "https://github.com/inpulse/core",
      normalizedUrl: "https://github.com/inpulse/core",
      kind: "OTHER",
      repository: "inpulse/core",
      externalNumber: null,
      externalSha: null,
    });

    expect(
      normalizeGitHubUrl("https://github.com/inpulse/core/issues/42"),
    ).toMatchObject({
      kind: "ISSUE",
      repository: "inpulse/core",
      externalNumber: "42",
      normalizedUrl: "https://github.com/inpulse/core/issues/42",
    });

    expect(
      normalizeGitHubUrl("https://github.com/inpulse/core/pull/7"),
    ).toMatchObject({
      kind: "PULL_REQUEST",
      repository: "inpulse/core",
      externalNumber: "7",
    });

    const commit = normalizeGitHubUrl(
      "https://github.com/inpulse/core/commit/0AB12CD34EF",
    );
    expect(commit).toMatchObject({
      kind: "COMMIT",
      repository: "inpulse/core",
      externalSha: "0ab12cd34ef",
    });
    expect(commit.normalizedUrl).toBe(
      "https://github.com/inpulse/core/commit/0AB12CD34EF",
    );
  });

  test("固定 scheme 与 host，移除默认端口、fragment 与尾部斜杠", () => {
    expect(
      normalizeGitHubUrl("https://github.com:443/inpulse/core/#readme")
        .normalizedUrl,
    ).toBe("https://github.com/inpulse/core");
    expect(
      normalizeGitHubUrl("https://GitHub.com/inpulse/core/issues/9")
        .normalizedUrl,
    ).toBe("https://github.com/inpulse/core/issues/9");
  });

  test("只保留 query 白名单并按 key 排序，丢弃未知参数", () => {
    expect(
      normalizeGitHubUrl(
        "https://github.com/inpulse/core/issues?tab=open&page=2&token=secret",
      ).normalizedUrl,
    ).toBe("https://github.com/inpulse/core/issues?page=2&tab=open");
    expect(
      normalizeGitHubUrl(
        "https://github.com/inpulse/core/issues?utm_source=x#issue-1",
      ).normalizedUrl,
    ).toBe("https://github.com/inpulse/core/issues");
  });

  test.each([
    "http://github.com/inpulse/core",
    "ftp://github.com/inpulse/core",
    // 用被 check:secrets 白名单接受的占位值，避免把「拒绝用户信息」的用例
    // 误判成仓库内嵌口令。
    "https://user:****@github.com/inpulse/core",
    "https://github.com:8443/inpulse/core",
    "https://api.github.com/repos/inpulse/core",
    "https://github.com.evil.example/inpulse/core",
    "https://evil.example/?next=https://github.com/inpulse/core",
    "https://gist.github.com/inpulse/0ab12cd34ef",
    "not a url",
    "",
    "https://github.com/" + "a".repeat(2100),
  ])("拒绝不符合策略的链接：%s", (raw) => {
    expect(() => normalizeGitHubUrl(raw)).toThrow(InvalidGitHubUrlError);
  });

  test("拒绝会把子路径伪装成仓库名的编码输入", () => {
    expect(() =>
      normalizeGitHubUrl("https://github.com/inpulse%2Fcore/issues/1"),
    ).toThrow(InvalidGitHubUrlError);
  });

  test("Issue/PR 编号必须是正整数，Commit 必须是 7-64 位十六进制", () => {
    expect(normalizeGitHubUrl("https://github.com/a/b/issues/0")).toMatchObject(
      {
        kind: "OTHER",
        externalNumber: null,
      },
    );
    expect(
      normalizeGitHubUrl("https://github.com/a/b/issues/not-a-number"),
    ).toMatchObject({ kind: "OTHER", externalNumber: null });
    expect(
      normalizeGitHubUrl("https://github.com/a/b/commit/abc"),
    ).toMatchObject({ kind: "OTHER", externalSha: null });
  });
});
