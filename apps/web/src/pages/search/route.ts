import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const SearchPage = lazy(() => import("./SearchPage"));

export const searchRoute: AppRouteModule = {
  path: "/search",
  element: SearchPage,
  requiresAuth: false,
};

export default searchRoute;
