import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const route: AppRouteModule = {
  path: "/projects/:projectId/members",
  element: lazy(() => import("./ProjectMembersPage")),
  requiresAdmin: true,
};

export default route;
