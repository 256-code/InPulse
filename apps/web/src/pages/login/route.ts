import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const LoginPage = lazy(() => import("./LoginPage"));

export const loginRoute: AppRouteModule = {
  path: "/login",
  element: LoginPage,
  requiresAuth: false,
};

export default loginRoute;
