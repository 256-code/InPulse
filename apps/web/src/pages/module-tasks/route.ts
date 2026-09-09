import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";
const route: AppRouteModule = {
  path: "/projects/:projectId/modules/:moduleId/tasks",
  element: lazy(() => import("./ModuleTasksPage")),
  requiresAuth: true,
};
export default route;
