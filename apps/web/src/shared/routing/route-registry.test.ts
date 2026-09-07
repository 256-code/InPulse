import React from "react";
import { describe, it, expect } from "vitest";
import { buildRouteObjects, DuplicateRoutePathError } from "./route-registry";
import type { AppRouteModule } from "./route-descriptor";

describe("buildRouteObjects", () => {
  const DummyHome: React.FC = () => React.createElement("div", null, "Home");
  const DummyAdmin: React.FC = () => React.createElement("div", null, "Admin");

  it("converts AppRouteModule list to RouteObject list", () => {
    const modules: AppRouteModule[] = [
      { path: "/", element: DummyHome, requiresAuth: false }
    ];

    const routes = buildRouteObjects(modules);
    expect(routes).toHaveLength(1);
    expect(routes[0]?.path).toBe("/");
  });

  it("throws DuplicateRoutePathError when duplicate paths are detected", () => {
    const modules: AppRouteModule[] = [
      { path: "/home", element: DummyHome },
      { path: "/home", element: DummyAdmin }
    ];

    expect(() => buildRouteObjects(modules)).toThrow(DuplicateRoutePathError);
    expect(() => buildRouteObjects(modules)).toThrow('Duplicate route path registered: "/home"');
  });

  it("applies authWrapper when requiresAuth or requiresAdmin is set", () => {
    let wrappedCount = 0;
    const authWrapper = (el: React.ReactElement, requiresAdmin?: boolean) => {
      wrappedCount++;
      return React.createElement("div", { "data-testid": "auth-wrapper", "data-admin": requiresAdmin }, el);
    };

    const modules: AppRouteModule[] = [
      { path: "/public", element: DummyHome, requiresAuth: false },
      { path: "/protected", element: DummyHome, requiresAuth: true },
      { path: "/admin", element: DummyAdmin, requiresAdmin: true }
    ];

    const routes = buildRouteObjects(modules, { authWrapper });
    expect(routes).toHaveLength(3);
    expect(wrappedCount).toBe(2);
  });
});
