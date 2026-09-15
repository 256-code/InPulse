import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const route: AppRouteModule = {
  path: "/projects/:projectId/members",
  element: lazy(() => import("./ProjectMembersPage")),
  requiresAuth: true,
};

export default route;
