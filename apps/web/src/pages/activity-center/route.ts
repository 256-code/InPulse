import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const ActivityCenterPage = lazy(() => import("./ActivityCenterPage"));

export const activityCenterRoute: AppRouteModule = {
  path: "/activity",
  element: ActivityCenterPage,
  requiresAuth: true,
};

export default activityCenterRoute;
