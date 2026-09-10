import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const RecordsPage = lazy(() => import("./RecordsPage"));

export const recordsRoute: AppRouteModule = {
  path: "/records",
  element: RecordsPage,
  requiresAuth: true,
};

export default recordsRoute;
