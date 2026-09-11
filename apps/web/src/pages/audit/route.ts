import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const AuditPage = lazy(() => import("./AuditPage"));

export const auditRoute: AppRouteModule = {
  path: "/audit",
  element: AuditPage,
  requiresAdmin: true,
};

export default auditRoute;
