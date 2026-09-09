import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";
const route: AppRouteModule = {
  path: "/projects/:projectId/modules/:moduleId/features/:featureId?",
  element: lazy(() => import("./FeaturesPage")),
  requiresAuth: true,
};
export default route;
