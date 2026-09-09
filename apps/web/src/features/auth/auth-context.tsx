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
  type ReauthenticateAdminRequest,
  type UserAuthState,
} from "@generated/api";
import {
  describeLoginError,
  isMfaSessionInvalid,
  isUnauthenticated,
} from "./auth-errors";

export type AuthStatus = "loading" | "anonymous" | "authenticated" | "error";

export type MfaAuthState = Exclude<UserAuthState, "AUTHENTICATED">;

export interface MfaEnrollmentMaterial {
  readonly enrollmentGeneration: number;
  readonly secret: string;
  readonly otpauthUri: string;
}

export type AuthLoginResult =
  | { readonly kind: "authenticated"; readonly user: CurrentUserResponse }
  | {
      readonly kind: "mfa-required";
      readonly authState: MfaAuthState;
      readonly enrollmentGeneration?: number;
    }
  | { readonly kind: "cancelled" };

export type MfaUpgradeResult =
  | {
      readonly kind: "authenticated";
      readonly user: CurrentUserResponse;
      readonly recoveryCodes?: readonly string[];
    }
  | { readonly kind: "cancelled" };

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: CurrentUserResponse | null;
  readonly errorMessage: string | null;
  readonly mfaState: MfaAuthState | null;
  readonly enrollmentGeneration: number | null;
  readonly pendingRecoveryCodes: readonly string[] | null;
  readonly login: (credentials: LoginRequest) => Promise<AuthLoginResult>;
  readonly logout: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly beginMfaEnrollment: () => Promise<MfaEnrollmentMaterial>;
  readonly confirmMfaEnrollment: (
    code: string,
    expectedEnrollmentGeneration: number,
  ) => Promise<MfaUpgradeResult>;
  readonly verifyMfa: (code: string) => Promise<MfaUpgradeResult>;
  readonly consumeMfaRecoveryCode: (code: string) => Promise<MfaUpgradeResult>;
  readonly finishMfaEnrollment: () => void;
  readonly reauthenticateAdmin: (
    input: ReauthenticateAdminRequest,
  ) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const defaultAuthValue: AuthContextValue = {
  status: "anonymous",
  user: null,
  errorMessage: null,
  mfaState: null,
  enrollmentGeneration: null,
  pendingRecoveryCodes: null,
  login: async () => ({ kind: "cancelled" }),
  logout: async () => {},
  refresh: async () => {},
  beginMfaEnrollment: async () => {
    throw new Error("MFA 注册会话未初始化");
  },
  confirmMfaEnrollment: async () => ({ kind: "cancelled" }),
  verifyMfa: async () => ({ kind: "cancelled" }),
  consumeMfaRecoveryCode: async () => ({ kind: "cancelled" }),
  finishMfaEnrollment: () => {},
  reauthenticateAdmin: async () => {},
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
  const csrfTokenRef = useRef<string | null>(null);
  const enrollmentGenerationRef = useRef<number | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<CurrentUserResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mfaState, setMfaState] = useState<MfaAuthState | null>(null);
  const [enrollmentGeneration, setEnrollmentGeneration] = useState<
    number | null
  >(null);
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<
    readonly string[] | null
  >(null);

  const clearMfaSession = useCallback((preservePending = false) => {
    setMfaState(null);
    setEnrollmentGeneration(null);
    enrollmentGenerationRef.current = null;
    if (!preservePending) {
      setPendingRecoveryCodes(null);
    }
  }, []);

  const restoreCurrentUser =
    useCallback(async (): Promise<CurrentUserResponse | null> => {
      const sequence = ++requestSequence.current;
      try {
        const currentUser = await apiClient.getCurrentUser();
        if (sequence !== requestSequence.current) {
          return null;
        }
        setStatus("authenticated");
        setUser(currentUser);
        clearMfaSession(true);
        setErrorMessage(null);
        return currentUser;
      } catch (error) {
        if (sequence !== requestSequence.current) {
          return null;
        }
        if (isUnauthenticated(error) || isMfaSessionInvalid(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
          setErrorMessage(null);
          try {
            const csrf = await apiClient.issueCsrfToken();
            if (sequence === requestSequence.current) {
              csrfTokenRef.current = csrf.csrfToken;
            }
          } catch {
            if (sequence === requestSequence.current) {
              setStatus("error");
              setErrorMessage("无法初始化安全登录状态，请刷新页面后重试。");
            }
          }
          return null;
        }
        setStatus("error");
        setUser(null);
        setErrorMessage("无法确认登录状态，请稍后重试。");
        return null;
      }
    }, [apiClient, clearMfaSession]);

  const refresh = useCallback(async (): Promise<void> => {
    await restoreCurrentUser();
  }, [restoreCurrentUser]);

  const login = useCallback(
    async (credentials: LoginRequest): Promise<AuthLoginResult> => {
      const sequence = ++requestSequence.current;
      try {
        const csrf = await apiClient.issueCsrfToken();
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        csrfTokenRef.current = csrf.csrfToken;
        const response = await apiClient.login(credentials, {
          headers: { "x-csrf-token": csrf.csrfToken },
        });
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        if (response.authState !== "AUTHENTICATED") {
          csrfTokenRef.current = response.csrfToken;
          setStatus("anonymous");
          setUser(null);
          setErrorMessage(null);
          setPendingRecoveryCodes(null);
          setMfaState(response.authState);
          setEnrollmentGeneration(response.enrollmentGeneration ?? null);
          enrollmentGenerationRef.current =
            response.enrollmentGeneration ?? null;
          return {
            kind: "mfa-required",
            authState: response.authState,
            ...(response.enrollmentGeneration === undefined
              ? {}
              : {
                  enrollmentGeneration: response.enrollmentGeneration,
                }),
          };
        }
        csrfTokenRef.current = response.csrfToken;
        const currentUser = await restoreCurrentUser();
        if (currentUser === null) {
          return { kind: "cancelled" };
        }
        return { kind: "authenticated", user: currentUser };
      } catch (error) {
        if (sequence !== requestSequence.current) {
          throw error;
        }
        if (isUnauthenticated(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
          setErrorMessage(null);
        } else {
          setStatus("error");
          setUser(null);
          clearMfaSession(false);
          setErrorMessage(describeLoginError(error));
        }
        throw error;
      }
    },
    [apiClient, clearMfaSession, restoreCurrentUser],
  );

  const logout = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current;
    try {
      const csrf = await apiClient.issueCsrfToken();
      if (sequence !== requestSequence.current) {
        return;
      }
      csrfTokenRef.current = csrf.csrfToken;
      await apiClient.logout({
        headers: { "x-csrf-token": csrf.csrfToken },
      });
      if (sequence !== requestSequence.current) {
        return;
      }
      setStatus("anonymous");
      setUser(null);
      clearMfaSession(false);
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
  }, [apiClient, clearMfaSession]);

  const beginMfaEnrollment =
    useCallback(async (): Promise<MfaEnrollmentMaterial> => {
      const token = csrfTokenRef.current;
      const generation = enrollmentGenerationRef.current;
      if (
        mfaState !== "MFA_ENROLLMENT" ||
        token === null ||
        generation === null
      ) {
        throw new Error("MFA 注册会话未初始化");
      }
      try {
        const response = await apiClient.startMfaEnrollment(
          { expectedEnrollmentGeneration: generation },
          { headers: { "x-csrf-token": token } },
        );
        enrollmentGenerationRef.current = response.enrollmentGeneration;
        setEnrollmentGeneration(response.enrollmentGeneration);
        return response;
      } catch (error) {
        if (isMfaSessionInvalid(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
        }
        throw error;
      }
    }, [apiClient, clearMfaSession, mfaState]);

  const confirmMfaEnrollment = useCallback(
    async (
      code: string,
      expectedEnrollmentGeneration: number,
    ): Promise<MfaUpgradeResult> => {
      const sequence = ++requestSequence.current;
      const token = csrfTokenRef.current;
      if (token === null) {
        throw new Error("MFA 注册会话未初始化");
      }
      try {
        const response = await apiClient.confirmMfaEnrollment(
          { expectedEnrollmentGeneration, code },
          { headers: { "x-csrf-token": token } },
        );
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        csrfTokenRef.current = response.csrfToken;
        const currentUser = await restoreCurrentUser();
        if (currentUser === null) {
          return { kind: "cancelled" };
        }
        setPendingRecoveryCodes(response.recoveryCodes);
        return {
          kind: "authenticated",
          user: currentUser,
          recoveryCodes: response.recoveryCodes,
        };
      } catch (error) {
        if (sequence !== requestSequence.current) {
          throw error;
        }
        if (isMfaSessionInvalid(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
        }
        throw error;
      }
    },
    [apiClient, clearMfaSession, restoreCurrentUser],
  );

  const verifyMfa = useCallback(
    async (code: string): Promise<MfaUpgradeResult> => {
      const sequence = ++requestSequence.current;
      const token = csrfTokenRef.current;
      if (token === null) {
        throw new Error("MFA 验证会话未初始化");
      }
      try {
        const response = await apiClient.verifyMfa(
          { code },
          { headers: { "x-csrf-token": token } },
        );
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        csrfTokenRef.current = response.csrfToken;
        const currentUser = await restoreCurrentUser();
        if (currentUser === null) {
          return { kind: "cancelled" };
        }
        return { kind: "authenticated", user: currentUser };
      } catch (error) {
        if (sequence !== requestSequence.current) {
          throw error;
        }
        if (isMfaSessionInvalid(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
        }
        throw error;
      }
    },
    [apiClient, clearMfaSession, restoreCurrentUser],
  );

  const consumeMfaRecoveryCode = useCallback(
    async (code: string): Promise<MfaUpgradeResult> => {
      const sequence = ++requestSequence.current;
      const token = csrfTokenRef.current;
      if (token === null) {
        throw new Error("恢复码会话未初始化");
      }
      try {
        const response = await apiClient.consumeMfaRecoveryCode(
          { code },
          { headers: { "x-csrf-token": token } },
        );
        if (sequence !== requestSequence.current) {
          return { kind: "cancelled" };
        }
        csrfTokenRef.current = response.csrfToken;
        const currentUser = await restoreCurrentUser();
        if (currentUser === null) {
          return { kind: "cancelled" };
        }
        return { kind: "authenticated", user: currentUser };
      } catch (error) {
        if (sequence !== requestSequence.current) {
          throw error;
        }
        if (isMfaSessionInvalid(error)) {
          setStatus("anonymous");
          setUser(null);
          clearMfaSession(false);
        }
        throw error;
      }
    },
    [apiClient, clearMfaSession, restoreCurrentUser],
  );

  const finishMfaEnrollment = useCallback(() => {
    setPendingRecoveryCodes(null);
  }, []);

  const reauthenticateAdmin = useCallback(
    async (input: ReauthenticateAdminRequest): Promise<void> => {
      const csrf = await apiClient.issueCsrfToken();
      csrfTokenRef.current = csrf.csrfToken;
      await apiClient.reauthenticateAdmin(input, {
        headers: { "x-csrf-token": csrf.csrfToken },
      });
    },
    [apiClient],
  );

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
      mfaState,
      enrollmentGeneration,
      pendingRecoveryCodes,
      login,
      logout,
      refresh,
      beginMfaEnrollment,
      confirmMfaEnrollment,
      verifyMfa,
      consumeMfaRecoveryCode,
      finishMfaEnrollment,
      reauthenticateAdmin,
    }),
    [
      status,
      user,
      errorMessage,
      mfaState,
      enrollmentGeneration,
      pendingRecoveryCodes,
      login,
      logout,
      refresh,
      beginMfaEnrollment,
      confirmMfaEnrollment,
      verifyMfa,
      consumeMfaRecoveryCode,
      finishMfaEnrollment,
      reauthenticateAdmin,
    ],
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
