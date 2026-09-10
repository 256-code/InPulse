import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const ProjectOverviewPage = lazy(() => import("./ProjectOverviewPage"));

export const projectOverviewRoute: AppRouteModule = {
  path: "/projects/:projectId/overview",
  element: ProjectOverviewPage,
  requiresAuth: true,
};

export default projectOverviewRoute;
