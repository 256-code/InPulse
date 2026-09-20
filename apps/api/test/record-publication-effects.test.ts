import { describe, it, expect } from "vitest";
import { validatePublishedRecordSearch } from "../src/modules/change-records/record-publication-effects.js";
const base = {
  id: 1,
  projectId: 1,
  code: "AB-CR-1",
  title: "标题",
  contextProblem: "问题",
  changeSolution: "方案",
  resultVerification: "验证",
  remainingIssues: [],
  rowVersion: 2,
};
const leftover = (contents: readonly string[]) =>
  contents.map((content) => ({ content }));
describe("F18 full search content capacity", () => {
  it("counts actual code, all fields and every leftover entry against the existing writer boundary without truncation", () => {
    // 写入侧用 "\n" 连接 code、四个正文段与每一条遗留问题；先量出最后一条之前的总长度（含分隔符）。
    const entries = ["遗留一", "遗留二", "遗留三"],
      build = (last: string) => ({
        ...base,
        remainingIssues: leftover([...entries.slice(0, -1), last]),
      }),
      head = [
        base.code,
        base.title,
        base.contextProblem,
        base.changeSolution,
        base.resultVerification,
        ...entries.slice(0, -1),
        "",
      ].join("\n").length,
      exact = build("中".repeat(100000 - head)),
      overflow = build("中".repeat(100000 - head + 1));
    expect(exact.remainingIssues).toHaveLength(entries.length);
    expect(validatePublishedRecordSearch(exact).rawText.length).toBe(100000);
    expect(() => validatePublishedRecordSearch(overflow)).toThrowError(
      expect.objectContaining({ status: 422 }),
    );
  });
  it("checks normalized expansion and UTF16 units using the same policy as the existing writer", () => {
    expect(() =>
      validatePublishedRecordSearch({
        ...base,
        changeSolution: "㍿".repeat(26000),
      }),
    ).toThrowError(expect.objectContaining({ status: 422 }));
    const raw = validatePublishedRecordSearch({
      ...base,
      changeSolution: "😀".repeat(49000),
    }).rawText;
    expect(raw).toContain("😀".repeat(49000));
    expect(raw.length).toBeGreaterThan(Array.from(raw).length);
    expect(() =>
      validatePublishedRecordSearch({
        ...base,
        changeSolution: "😀".repeat(50000),
      }),
    ).toThrowError(expect.objectContaining({ status: 422 }));
  });
});
