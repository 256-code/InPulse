import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createApiClient,
  type CurrentUserResponse,
  type InpulseApiClient,
  type LoginRequest,
  type UserAuthState,
} from "@generated/api";
import { describeLoginError, isUnauthenticated } from "./auth-errors";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "error";

export type MfaAuthState = Exclude<UserAuthState, "AUTHENTICATED">;

export type AuthLoginResult =
  | { readonly kind: "authenticated"; readonly user: CurrentUserResponse }
  | { readonly kind: "mfa-required"; readonly authState: MfaAuthState }
  | { readonly kind: "cancelled" };

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: CurrentUserResponse | null;
  readonly errorMessage: string | null;
  readonly login: (credentials: LoginRequest) => Promise<AuthLoginResult>;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const defaultAuthValue: AuthContextValue = {
  status: "anonymous",
  user: null,
  errorMessage: null,
  login: async () => ({ kind: "cancelled" }),
  logout: async () => {},
  refresh: async () => {},
};

export interface AuthStateProviderProps {
  readonly value?: Partial<AuthContextValue>;
  readonly children: React.ReactNode;
}

export const AuthStateProvider: React.FC<AuthStateProviderProps> = ({
  value,
  children,
}) => {
  const memoizedValue = useMemo<AuthContextValue>(
    () => ({ ...defaultAuthValue, ...value }),
    [value],
  );
  return React.createElement(
    AuthContext.Provider,
    { value: memoizedValue },
    children,
  );
};

export interface AuthProviderProps {
  readonly client?: InpulseApiClient;
  readonly children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({
  client,
  children,
}) => {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const requestSequence = useRef(0);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<CurrentUserResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    try {
      const currentUser = await apiClient.getCurrentUser();
      if (sequence !== requestSequence.current) {
        return;
      }
      setStatus("authenticated");
      setUser(currentUser);
      setErrorMessage(null);
      return;
    } catch (error) {
      if (sequence !== requestSequence.current) {
        return;
      }
      if (!isUnauthenticated(error)) {
        setStatus("error");
        setUser(null);
        setErrorMessage("无法确认登录状态，请稍后重试。");
        return;
      }
      try {
        await apiClient.issueCsrfToken();
      } catch {
        if (sequence !== requestSequence.current) {
          return;
        }
        setStatus("error");
        setUser(null);
        setErrorMessage("无法初始化安全登录状态，请刷新页面后重试。");
        return;
      }
      if (sequence !== requestSequence.current) {
        return;
      }
      setStatus("anonymous");
      setUser(null);
      setErrorMessage(null);
    }
  }, [apiClient]);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<AuthLoginResult> => {
      const sequence = ++requestSequence.current;
      try {
        const csrf = await apiClient.issueCsrfToken();
        const response = await apiClient.login(credentials, {
          headers: { "x-csrf-token": csrf.csrfToken },
        });
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        if (response.authState !== "AUTHENTICATED") {
          setStatus("anonymous");
          setUser(null);
          setErrorMessage(null);
          return {
            kind: "mfa-required",
            authState: response.authState,
          };
        }
        const currentUser = await apiClient.getCurrentUser();
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        setStatus("authenticated");
        setUser(currentUser);
        setErrorMessage(null);
        return { kind: "authenticated", user: currentUser };
      } catch (error) {
        if (sequence !== requestSequence.current) {
          throw error;
        }
        if (isUnauthenticated(error)) {
          setStatus("anonymous");
          setUser(null);
          setErrorMessage(null);
        } else {
          setStatus("error");
          setUser(null);
          setErrorMessage(describeLoginError(error));
        }
        throw error;
      }
    },
    [apiClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    try {
      const csrf = await apiClient.issueCsrfToken();
      await apiClient.logout({
        headers: { "x-csrf-token": csrf.csrfToken },
      });
      if (sequence !== requestSequence.current) {
        return;
      }
      setStatus("anonymous");
      setUser(null);
      setErrorMessage(null);
    } catch (error) {
      if (sequence !== requestSequence.current) {
        throw error;
      }
      setStatus("error");
      setUser(null);
      setErrorMessage("退出失败，请刷新页面后重试。");
      throw error;
    }
  }, [apiClient]);

  useEffect(() => {
    void refresh();
    return () => {
      requestSequence.current += 1;
    };
  }, [refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      errorMessage,
      login,
      logout,
      refresh,
    }),
    [status, user, errorMessage, login, logout, refresh],
  );

  return React.createElement(AuthContext.Provider, { value }, children);
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an auth provider");
  }
  return ctx;
}
