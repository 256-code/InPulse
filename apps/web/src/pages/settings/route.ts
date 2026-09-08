import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const SettingsPage = lazy(() => import("./SettingsPage"));

export const settingsRoute: AppRouteModule = {
  path: "/settings",
  element: SettingsPage,
  requiresAuth: false,
};

export default settingsRoute;
