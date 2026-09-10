import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const TasksPage = lazy(() => import("./TasksPage"));

export const tasksRoute: AppRouteModule = {
  path: "/tasks",
  element: TasksPage,
  requiresAuth: true,
};

export default tasksRoute;
