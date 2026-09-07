import React, { useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, type ConfigProviderProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import { appTheme } from "../theme/theme";
import { AuthStateProvider } from "../auth/auth-context";

export interface AppProvidersProps {
  readonly children: React.ReactNode;
  readonly queryClient?: QueryClient;
}

export function getCspNonce(): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const meta = document.querySelector('meta[name="csp-nonce"]');
  return meta?.getAttribute("content") || undefined;
}

export const AppProviders: React.FC<AppProvidersProps> = ({
  children,
  queryClient
}) => {
  const client = useMemo(
    () =>
      queryClient ??
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            staleTime: 5000
          }
        }
      }),
    [queryClient]
  );

  const nonce = getCspNonce();

  const configProps: ConfigProviderProps = {
    locale: zhCN,
    theme: appTheme
  };

  if (nonce) {
    configProps.csp = { nonce };
  }

  return (
    <QueryClientProvider client={client}>
      <ConfigProvider {...configProps}>
        <AuthStateProvider>
          {children}
        </AuthStateProvider>
      </ConfigProvider>
    </QueryClientProvider>
  );
};
