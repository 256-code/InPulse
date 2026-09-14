import { describe, expect, it } from "vitest";
import { treePath, treeScopeOf } from "./tree-selection";

describe("project tree selection", () => {
  it("resolves the active tree node from catalog path ids", () => {
    expect(
      treeScopeOf({ projectId: null, moduleId: null, featureId: null }),
    ).toBeNull();
    expect(
      treeScopeOf({ projectId: 2, moduleId: null, featureId: null }),
    ).toEqual({ projectId: 2, selection: { kind: "project" } });
    expect(treeScopeOf({ projectId: 2, moduleId: 3, featureId: null })).toEqual(
      {
        projectId: 2,
        selection: { kind: "module", moduleId: 3 },
      },
    );
    expect(treeScopeOf({ projectId: 2, moduleId: 3, featureId: 5 })).toEqual({
      projectId: 2,
      selection: { kind: "feature", moduleId: 3, featureId: 5 },
    });
  });

  it("maps every tree level onto an existing project page", () => {
    expect(treePath(2, { kind: "project" })).toBe("/projects/2/modules");
    expect(treePath(2, { kind: "module", moduleId: 3 })).toBe(
      "/projects/2/modules/3/features",
    );
    expect(treePath(2, { kind: "feature", moduleId: 3, featureId: 5 })).toBe(
      "/projects/2/modules/3/features/5",
    );
  });
});
