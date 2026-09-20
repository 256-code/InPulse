import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const TaskBoardPage = lazy(() => import("./TaskBoardPage"));

export const taskBoardRoute: AppRouteModule = {
  path: "/projects/:projectId/task-board",
  element: TaskBoardPage,
  requiresAuth: true,
};

export default taskBoardRoute;
