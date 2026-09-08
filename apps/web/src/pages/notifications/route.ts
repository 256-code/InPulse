import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const NotificationsPage = lazy(() => import("./NotificationsPage"));

export const notificationsRoute: AppRouteModule = {
  path: "/notifications",
  element: NotificationsPage,
  requiresAuth: true,
};

export default notificationsRoute;
