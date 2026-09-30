import React, { useEffect } from "react";
import { AppProviders } from "./providers/AppProviders";
import { AppErrorBoundary } from "./errors/AppErrorBoundary";
import { AppRouter } from "./router/AppRouter";
import { installAutoHideScrollbars } from "./auto-hide-scrollbars";

export function App() {
  // 全站滚动条按需显形（2026-09-24 产品要求）：挂在应用根上，登录页等全部路由一并生效。
  useEffect(() => installAutoHideScrollbars(document), []);

  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  );
}

export default App;
