import { describe, expect, it } from "vitest";
import { assertModuleTransition } from "../src/modules/modules/modules-management.service.js";

describe("module lifecycle", () => {
  it("rejects stale edits and invalid state transitions, including unclassified modules", () => {
    expect(() =>
      assertModuleTransition(
        "updateModule",
        { rowVersion: 2, status: "ACTIVE" },
        1,
      ),
    ).toThrow("版本");
    expect(() =>
      assertModuleTransition(
        "updateModule",
        { rowVersion: 2, status: "ARCHIVED" },
        2,
      ),
    ).toThrow("状态");
    expect(() =>
      assertModuleTransition(
        "restoreModule",
        { rowVersion: 2, status: "ACTIVE" },
        2,
      ),
    ).toThrow("状态");
    expect(() =>
      assertModuleTransition(
        "archiveModule",
        { rowVersion: 2, status: "ARCHIVED" },
        2,
      ),
    ).toThrow("状态");
    expect(() =>
      assertModuleTransition(
        "restoreModule",
        { rowVersion: 2, status: "ARCHIVED" },
        2,
      ),
    ).not.toThrow();
  });
});
