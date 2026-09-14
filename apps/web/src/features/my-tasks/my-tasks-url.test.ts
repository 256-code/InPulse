import { describe, expect, it } from "vitest";
import {
  countActiveMyTaskFilters,
  DEFAULT_MY_TASK_FILTERS,
  readMyTaskAdvancedOpen,
  readMyTaskFilters,
  writeMyTaskFilters,
} from "./my-tasks-url";
import type { MyTaskFilters } from "./my-tasks-types";

describe("my-tasks-url", () => {
  it("reads default filters from an empty URL", () => {
    expect(readMyTaskFilters(new URLSearchParams())).toEqual(
      DEFAULT_MY_TASK_FILTERS,
    );
    expect(readMyTaskAdvancedOpen(new URLSearchParams())).toBe(false);
  });

  it("round-trips a fully specified filter set through the URL", () => {
    const filters: MyTaskFilters = {
      scope: "project",
      projectId: 7,
      status: "all",
      priority: "HIGH",
      level: "FEATURE",
      relation: "MAIN",
      hasRecord: "no",
      hasGithub: "yes",
      includeCanceled: true,
      query: "登录",
      display: "list",
    };

    const params = writeMyTaskFilters(filters, { advancedOpen: true });
    expect(readMyTaskFilters(params, { isAdmin: true })).toEqual(filters);
    expect(readMyTaskAdvancedOpen(params)).toBe(true);
  });

  it("omits default values when writing the URL", () => {
    expect(writeMyTaskFilters(DEFAULT_MY_TASK_FILTERS).toString()).toBe("");
    expect(
      writeMyTaskFilters(DEFAULT_MY_TASK_FILTERS, {
        advancedOpen: false,
      }).toString(),
    ).toBe("");
  });

  it("keeps the project id only for the project scope", () => {
    const params = writeMyTaskFilters({
      ...DEFAULT_MY_TASK_FILTERS,
      scope: "mine",
      projectId: 9,
    });
    expect(params.get("project")).toBeNull();
  });

  it("falls back to defaults for invalid values", () => {
    const params = new URLSearchParams(
      "scope=everything&project=0&status=nope&priority=MAYBE&level=X&relation=Y&record=maybe&github=maybe&canceled=1&view=grid",
    );
    expect(readMyTaskFilters(params)).toEqual({
      ...DEFAULT_MY_TASK_FILTERS,
      includeCanceled: true,
    });
  });

  it("rejects out-of-range project ids", () => {
    expect(
      readMyTaskFilters(new URLSearchParams("project=2147483648")).projectId,
    ).toBeNull();
    expect(
      readMyTaskFilters(new URLSearchParams("project=2147483647")).projectId,
    ).toBe(2147483647);
  });

  it("demotes the admin-only scope for non-admins", () => {
    const params = new URLSearchParams("scope=all");
    expect(readMyTaskFilters(params).scope).toBe("mine");
    expect(readMyTaskFilters(params, { isAdmin: true }).scope).toBe("all");
  });

  it("trims the query before persisting it", () => {
    expect(
      writeMyTaskFilters({ ...DEFAULT_MY_TASK_FILTERS, query: "  登录  " }).get(
        "q",
      ),
    ).toBe("登录");
    expect(
      writeMyTaskFilters({ ...DEFAULT_MY_TASK_FILTERS, query: "  " }).get("q"),
    ).toBeNull();
  });

  it("counts active filters without scope and display mode", () => {
    expect(countActiveMyTaskFilters(DEFAULT_MY_TASK_FILTERS)).toBe(0);
    expect(
      countActiveMyTaskFilters({
        ...DEFAULT_MY_TASK_FILTERS,
        scope: "project",
        display: "list",
        query: "  ",
      }),
    ).toBe(0);
    expect(
      countActiveMyTaskFilters({
        ...DEFAULT_MY_TASK_FILTERS,
        status: "done",
        priority: "URGENT",
        level: "MODULE",
        relation: "SOURCE",
        hasRecord: "yes",
        hasGithub: "no",
        includeCanceled: true,
        query: "登录",
      }),
    ).toBe(8);
  });
});
