import React, { useMemo } from "react";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ConfigProvider, type ConfigProviderProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import type { InpulseApiClient } from "@generated/api";
import { AuthProvider } from "@features/auth/auth-context";
import { reportSessionExpired } from "@features/auth/session-recovery";
import { invalidateShellCounters } from "@shared/api/shell-counters";
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
        // ADR-032：会话过期后受保护请求返回 401，这里统一收敛认证态，
        // 由 RequireAuth 静默重走统一身份认证；403、404、409、500 等不参与。
        queryCache: new QueryCache({ onError: reportSessionExpired }),
        // 侧栏导航计数是服务端聚合的派生值，写操作成功后必须重新取数，否则
        // 新建 / 完成任务、发布记录产生遗留项、遗留问题转任务后，数字要刷新
        // 页面才更新（2026-09-22 修）。逐条写在各自 mutation 的 onSuccess 里
        // 必然漏路径，因此这里统一失效；直接调用生成客户端的写路径见
        // @shared/api/shell-counters。
        mutationCache: new MutationCache({
          onError: reportSessionExpired,
          onSuccess: (_data, _variables, _result, _mutation, context) => {
            void invalidateShellCounters(context.client);
          },
        }),
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
    /**
     * antd 默认给"恰好两个汉字"的按钮插入空格（编 辑 / 归 档 / 取 消），
     * 与设计师稿的按钮文案不一致，全局关闭。
     */
    button: { autoInsertSpace: false },
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
