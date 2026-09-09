import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const ProjectsPage = lazy(() => import("./ProjectsPage"));

export const projectsRoute: AppRouteModule = {
  path: "/projects",
  element: ProjectsPage,
  requiresAuth: true,
};

export default projectsRoute;
