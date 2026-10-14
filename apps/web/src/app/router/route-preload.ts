/**
 * 路由 chunk 预取的兼容出口（2026-10-14）。
 *
 * 实现已移到 `@shared/routing/route-preload`：除 app 层的侧栏导航与项目树，pages / features 层的
 * 跳转入口（项目卡片、通知项、搜索结果、命令面板）也要用它，而分层规则禁止它们反向依赖 app。
 * 这里只做同名 re-export，app 层与既有 import 路径不变；两份路径指向同一模块实例，不会重复预取。
 */
export {
  preloadRoutePath,
  routePreloadHandlers,
} from "@shared/routing/route-preload";
