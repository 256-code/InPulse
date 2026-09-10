import { describe, expect, it } from "vitest";
import { MY_TASKS_MOCK_ADAPTER } from "./my-tasks-mock";
import { DEFAULT_MY_TASK_FILTERS } from "./my-tasks-url";
import type { MyTaskFilters, MyTaskListItem } from "./my-tasks-types";

const fetchDefault = async (patch: Partial<MyTaskFilters> = {}) =>
  MY_TASKS_MOCK_ADAPTER.fetchMyTasks({
    filters: { ...DEFAULT_MY_TASK_FILTERS, ...patch },
    viewerId: 1,
  });

const codesOf = (items: readonly MyTaskListItem[]) =>
  items.map((item) => item.code);

describe("my-tasks mock adapter", () => {
  it("serves the demo dataset as a mock source", async () => {
    expect(MY_TASKS_MOCK_ADAPTER.source).toBe("mock");
    const result = await fetchDefault();
    expect(result.items.every((item) => item.workStatus === "TODO")).toBe(true);
    expect(codesOf(result.items)).toEqual(["T-101", "T-102", "T-103", "T-108"]);
  });

  it("keeps done and canceled tasks out of the default view", async () => {
    const result = await fetchDefault();
    expect(codesOf(result.items)).not.toContain("T-104");
    expect(codesOf(result.items)).not.toContain("T-107");
  });

  it("only shows canceled tasks when the toggle and status all match", async () => {
    const withToggleOnly = await fetchDefault({ includeCanceled: true });
    expect(codesOf(withToggleOnly.items)).not.toContain("T-107");

    const statusAllOnly = await fetchDefault({ status: "all" });
    expect(codesOf(statusAllOnly.items)).not.toContain("T-107");

    const both = await fetchDefault({ status: "all", includeCanceled: true });
    const all = codesOf(both.items);
    expect(all).toContain("T-107");
    expect(all).toContain("T-104");
    expect(all.indexOf("T-107")).toBe(all.length - 1);
  });

  it("filters the created scope by creator instead of assignee", async () => {
    const result = await fetchDefault({ scope: "created" });
    expect(codesOf(result.items)).toEqual([
      "T-101",
      "T-102",
      "T-105",
      "T-103",
      "T-108",
    ]);
  });

  it("filters the project scope by project id", async () => {
    const result = await fetchDefault({ scope: "project", projectId: 2 });
    expect(codesOf(result.items)).toEqual(["T-105", "T-103"]);
  });

  it("orders the admin scope across all projects", async () => {
    const result = await fetchDefault({ scope: "all" });
    expect(codesOf(result.items)).toEqual([
      "T-101",
      "T-102",
      "T-105",
      "T-103",
      "T-110",
      "T-108",
    ]);
  });

  it("supports priority, level, relation, record and github filters", async () => {
    expect(codesOf((await fetchDefault({ priority: "URGENT" })).items)).toEqual(
      ["T-101"],
    );
    expect(codesOf((await fetchDefault({ level: "MODULE" })).items)).toEqual([
      "T-102",
    ]);
    expect(codesOf((await fetchDefault({ relation: "MAIN" })).items)).toEqual([
      "T-102",
    ]);
    expect(codesOf((await fetchDefault({ hasRecord: "yes" })).items)).toEqual([
      "T-102",
    ]);
    expect(codesOf((await fetchDefault({ hasGithub: "yes" })).items)).toEqual([
      "T-101",
    ]);
  });

  it("matches the search term across code, title and belonging", async () => {
    expect(codesOf((await fetchDefault({ query: "恢复码" })).items)).toEqual([
      "T-101",
    ]);
    expect(
      codesOf((await fetchDefault({ query: "标题不存在的词" })).items),
    ).toEqual([]);
    expect(codesOf((await fetchDefault({ query: "t-108" })).items)).toEqual([
      "T-108",
    ]);
  });

  it("computes date-independent stats and leftover facts for the scope", async () => {
    const result = await fetchDefault();
    expect(result.stats.myOpen).toBe(4);
    expect(result.stats.dueToday).toBe(1);
    expect(result.stats.overdue).toBe(1);
    expect(result.stats.completedThisMonth).toBeGreaterThanOrEqual(2);
    expect(result.stats.completedThisMonth).toBeLessThanOrEqual(3);
    expect(result.leftoverCount).toBe(3);
    expect(result.leftoverSample?.recordCode).toBe("R-021");
    expect(result.scopeCounts).toEqual({
      mine: 8,
      created: 9,
      project: 10,
      all: 10,
    });
  });

  it("keeps the demo viewer until the server contract is frozen", async () => {
    const result = await MY_TASKS_MOCK_ADAPTER.fetchMyTasks({
      filters: DEFAULT_MY_TASK_FILTERS,
      viewerId: 999,
    });
    expect(codesOf(result.items)).toContain("T-101");
  });
});
