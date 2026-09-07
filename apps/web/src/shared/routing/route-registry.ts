import React, { Suspense } from "react";
import type { RouteObject } from "react-router-dom";
import type { AppRouteModule } from "./route-descriptor";

export interface RouteRegistryOptions {
  readonly authWrapper?: (
    element: React.ReactElement,
    requiresAdmin?: boolean,
  ) => React.ReactElement;
  readonly fallback?: React.ReactNode;
}

export class DuplicateRoutePathError extends Error {
  constructor(public readonly duplicatePath: string) {
    super(`Duplicate route path registered: "${duplicatePath}"`);
    this.name = "DuplicateRoutePathError";
  }
}

export function buildRouteObjects(
  routeModules: readonly AppRouteModule[],
  options: RouteRegistryOptions = {},
): RouteObject[] {
  const seenPaths = new Set<string>();

  function processRoutes(
    routes: readonly AppRouteModule[],
    parentPath = "",
  ): RouteObject[] {
    return routes.map((mod) => {
      const fullPath =
        parentPath === ""
          ? mod.path
          : `${parentPath.replace(/\/$/, "")}/${mod.path.replace(/^\//, "")}`;

      if (seenPaths.has(fullPath)) {
        throw new DuplicateRoutePathError(fullPath);
      }
      seenPaths.add(fullPath);

      const Component = mod.element;
      let element: React.ReactElement = React.createElement(Component);

      if (options.fallback !== undefined) {
        element = React.createElement(
          Suspense,
          { fallback: options.fallback },
          element,
        );
      }

      if (options.authWrapper && (mod.requiresAuth || mod.requiresAdmin)) {
        element = options.authWrapper(element, Boolean(mod.requiresAdmin));
      }

      const routeObj: RouteObject = {
        path: mod.path,
        element,
      };

      if (mod.children && mod.children.length > 0) {
        routeObj.children = processRoutes(mod.children, fullPath);
      }

      return routeObj;
    });
  }

  return processRoutes(routeModules);
}
