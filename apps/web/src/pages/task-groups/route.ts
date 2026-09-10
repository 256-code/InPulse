import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const TaskGroupPage = lazy(() => import("./TaskGroupPage"));

export const taskGroupRoute: AppRouteModule = {
  path: "/task-groups/:groupId",
  element: TaskGroupPage,
  requiresAuth: true,
};

export default taskGroupRoute;
