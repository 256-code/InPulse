import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const ActivityPage = lazy(() => import("./ActivityPage"));

export const activityRoute: AppRouteModule = {
  path: "/projects/:projectId/activity",
  element: ActivityPage,
  requiresAuth: true,
};

export default activityRoute;
