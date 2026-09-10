import React from "react";
import { RecordDraftsView } from "@features/record-drafts/RecordDraftsView";
import { PublishedRecordsView } from "@features/published-records/PublishedRecordsView";
import { useSearchParams } from "react-router-dom";
export default function RecordsPage() {
  const [params] = useSearchParams();
  const projectId = params.get("projectId");
  return (
    <>
      <nav aria-label="记录状态">
        <a href={`/records${projectId ? `?projectId=${projectId}` : ""}`}>
          草稿
        </a>
        {" · "}
        <a
          href={`/records?view=published${projectId ? `&projectId=${projectId}` : ""}`}
        >
          已发布记录
        </a>
      </nav>
      {params.get("view") === "published" ? (
        <PublishedRecordsView />
      ) : (
        <RecordDraftsView />
      )}
    </>
  );
}
