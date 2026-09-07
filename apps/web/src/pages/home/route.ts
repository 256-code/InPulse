import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const HomePage = lazy(() => import("./HomePage"));

export const homeRoute: AppRouteModule = {
  path: "/",
  element: HomePage,
  requiresAuth: false,
};

export default homeRoute;
