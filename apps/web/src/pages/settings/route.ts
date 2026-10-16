import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const SettingsPage = lazy(() => import("./SettingsPage"));

/** ADR-081：入口对全体成员开放——普通成员只读（同组织成员），管理能力由页面内按 isAdmin 收缩。 */
export const settingsRoute: AppRouteModule = {
  path: "/settings",
  element: SettingsPage,
  requiresAuth: true,
};

export default settingsRoute;
