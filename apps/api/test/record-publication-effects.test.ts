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
  remainingIssues: "",
  rowVersion: 2,
};
describe("F18 full search content capacity", () => {
  it("counts actual code and all fields against the existing writer boundary without truncation", () => {
    const prefix = [
      base.code,
      base.title,
      base.contextProblem,
      base.changeSolution,
      base.resultVerification,
      "",
    ].join("\n").length;
    const exact = { ...base, remainingIssues: "中".repeat(100000 - prefix) };
    expect(validatePublishedRecordSearch(exact).rawText.length).toBe(100000);
    expect(() =>
      validatePublishedRecordSearch({
        ...exact,
        remainingIssues: exact.remainingIssues + "中",
      }),
    ).toThrowError(expect.objectContaining({ status: 422 }));
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
