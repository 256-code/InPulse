import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const IssuesPage = lazy(() => import("./IssuesPage"));

export const issuesRoute: AppRouteModule = {
  path: "/issues",
  element: IssuesPage,
  requiresAuth: true,
};

export default issuesRoute;
