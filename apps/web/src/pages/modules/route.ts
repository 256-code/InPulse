import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";
const route: AppRouteModule = {
  path: "/projects/:projectId/modules",
  element: lazy(() => import("./ModulesPage")),
  requiresAuth: true,
};
export default route;
