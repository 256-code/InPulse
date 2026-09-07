import React from "react";
import { AppProviders } from "./providers/AppProviders";
import { AppErrorBoundary } from "./errors/AppErrorBoundary";
import { AppRouter } from "./router/AppRouter";

export function App() {
  return (
    <AppErrorBoundary>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </AppErrorBoundary>
  );
}

export default App;
