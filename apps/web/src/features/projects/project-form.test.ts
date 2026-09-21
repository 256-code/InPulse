import { describe, expect, it } from "vitest";
import { deriveProjectCodeFromName } from "./project-form";

describe("deriveProjectCodeFromName", () => {
  it("keeps english letters and digits, dropping chinese, spaces and symbols", () => {
    expect(deriveProjectCodeFromName("shop system")).toBe("SHOPSYSTEM");
    expect(deriveProjectCodeFromName("商城系统 Shop2")).toBe("SHOP2");
    expect(deriveProjectCodeFromName("SHOP-T-99")).toBe("SHOPT99");
    expect(deriveProjectCodeFromName("K1235 商城系统")).toBe("K1235");
  });

  it("returns an empty result when nothing valid can be derived", () => {
    expect(deriveProjectCodeFromName("")).toBe("");
    expect(deriveProjectCodeFromName("商城系统")).toBe("");
    expect(deriveProjectCodeFromName("A 项目")).toBe("");
    expect(deriveProjectCodeFromName("6DoF 云台")).toBe("");
  });

  it("truncates to the code length limit", () => {
    expect(deriveProjectCodeFromName("a".repeat(40))).toBe("A".repeat(32));
  });
});
