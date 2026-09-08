import React, { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { SearchPageView } from "@features/search/SearchPageView";

export interface SearchPageProps {
  readonly client?: InpulseApiClient;
}

export const SearchPage: React.FC<SearchPageProps> = ({ client }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const handleSubmit = useCallback(
    (query: string) => {
      const normalized = query.trim();
      setSearchParams(normalized ? { q: normalized } : {});
    },
    [setSearchParams],
  );

  return (
    <SearchPageView
      initialQuery={initialQuery}
      onSubmit={handleSubmit}
      {...(client ? { client } : {})}
    />
  );
};

export default SearchPage;
