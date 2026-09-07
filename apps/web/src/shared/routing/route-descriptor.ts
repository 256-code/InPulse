import type { ComponentType } from "react";

export interface AppRouteModule {
  readonly path: string;
  readonly element: ComponentType;
  readonly requiresAuth?: boolean;
  readonly requiresAdmin?: boolean;
  readonly children?: readonly AppRouteModule[];
}
