import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";

/**
 * 搜索参数作用域：整页视图（记录工作区、草稿条带、遗留问题）用 `useSearchParams`
 * 承载筛选与详情展开状态；装进项目主页弹窗时不能再套一层 Router
 * （react-router 禁止 Router 嵌套），改由本作用域用本地 state 提供同一份
 * `[params, setParams]` 契约——视图代码不变，地址栏不被弹窗交互污染。
 */
export type SearchParamsInit =
  | URLSearchParams
  | Record<string, string | readonly string[]>;

export type ScopedSetSearchParams = (
  next: SearchParamsInit,
  options?: { replace?: boolean },
) => void;

export type ScopedSearchParams = readonly [
  URLSearchParams,
  ScopedSetSearchParams,
];

const SearchParamsContext = createContext<ScopedSearchParams | null>(null);

export const SearchParamsScope: React.FC<{
  readonly initial: string;
  readonly children: React.ReactNode;
}> = ({ initial, children }) => {
  const [params, setParams] = useState(() => new URLSearchParams(initial));
  const set = useCallback<ScopedSetSearchParams>((next) => {
    setParams(new URLSearchParams(next));
  }, []);
  const value = useMemo(() => [params, set] as const, [params, set]);
  return (
    <SearchParamsContext.Provider value={value}>
      {children}
    </SearchParamsContext.Provider>
  );
};

/** 有作用域时用作用域状态，否则回落到路由搜索参数（整页行为不变）。 */
export function useScopedSearchParams(): ScopedSearchParams {
  const scoped = useContext(SearchParamsContext);
  const [routerParams, routerSet] = useSearchParams();
  const set = useCallback<ScopedSetSearchParams>(
    (next, options) => routerSet(next, options),
    [routerSet],
  );
  return useMemo(
    () => (scoped !== null ? scoped : ([routerParams, set] as const)),
    [scoped, routerParams, set],
  );
}
