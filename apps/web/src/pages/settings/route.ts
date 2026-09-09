import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const SettingsPage = lazy(() => import("./SettingsPage"));

export const settingsRoute: AppRouteModule = {
  path: "/settings",
  element: SettingsPage,
  requiresAdmin: true,
};

export default settingsRoute;
