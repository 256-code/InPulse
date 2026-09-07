import React, { createContext, useContext, useMemo } from "react";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface CurrentUser {
  readonly id: number;
  readonly username: string;
  readonly isSystemAdmin: boolean;
}

export interface AuthContextValue {
  readonly status: AuthStatus;
  readonly user: CurrentUser | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthStateProviderProps {
  readonly value?: AuthContextValue;
  readonly children: React.ReactNode;
}

export const AuthStateProvider: React.FC<AuthStateProviderProps> = ({
  value = { status: "anonymous", user: null },
  children
}) => {
  const memoizedValue = useMemo(() => value, [value.status, value.user]);
  return React.createElement(AuthContext.Provider, { value: memoizedValue }, children);
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthStateProvider");
  }
  return ctx;
}
