import React, { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, type ConfigProviderProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { InpulseApiClient } from "@generated/api";
import { AuthProvider } from "@features/auth/auth-context";
import { appTheme } from "../theme/theme";

export interface AppProvidersProps {
  readonly children: React.ReactNode;
  readonly queryClient?: QueryClient;
  readonly authClient?: InpulseApiClient;
}

/**
 * 读取 HTML 入口层注入的逐响应 nonce（生产 Nginx sub_filter / 开发与预览的
 * Vite 插件，见 apps/web/tools/vite-csp.ts 与 ADR-021）。Vite 8 的
 * `html.cspNonce` 约定是 `<meta property="csp-nonce" nonce="...">`，nonce 只通过
 * IDL 属性暴露（浏览器里 getAttribute 会被隐藏为空串）。
 */
export function getCspNonce(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const meta = document.querySelector<HTMLMetaElement>(
    'meta[property="csp-nonce"]',
  );
  if (!meta) {
    return undefined;
  }
  return meta.nonce || meta.getAttribute("nonce") || undefined;
}

export const AppProviders: React.FC<AppProvidersProps> = ({
  children,
  queryClient,
  authClient,
}) => {
  const client = useMemo(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5000,
          },
        },
      }),
    [queryClient],
  );

  const nonce = getCspNonce();

  const configProps: ConfigProviderProps = {
    locale: zhCN,
    theme: appTheme,
  };

  if (nonce) {
    configProps.csp = { nonce };
  }

  return (
    <QueryClientProvider client={client}>
      <ConfigProvider {...configProps}>
        {authClient ? (
          <AuthProvider client={authClient}>{children}</AuthProvider>
        ) : (
          <AuthProvider>{children}</AuthProvider>
        )}
      </ConfigProvider>
    </QueryClientProvider>
  );
};
