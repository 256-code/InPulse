import React from "react";
import { useSearchParams } from "react-router-dom";
import { CalmSegmented } from "@features/common/components/Calm";
import { RecordDraftsView } from "@features/record-drafts/RecordDraftsView";
import { PublishedRecordsView } from "@features/published-records/PublishedRecordsView";

type RecordsView = "drafts" | "published";

export default function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const view: RecordsView =
    params.get("view") === "published" ? "published" : "drafts";
  const selectView = (next: RecordsView) => {
    const nextParams = new URLSearchParams(params);
    if (next === "published") {
      nextParams.set("view", "published");
    } else {
      nextParams.delete("view");
    }
    setParams(nextParams);
  };
  return (
    <div className="records-page">
      {/* 设计师稿 latest-version/views/records.tsx L58-66：记录页标题区。 */}
      <div className="page-header">
        <div>
          <div className="eyebrow">研发记录</div>
          <h1>迭代记录</h1>
          <p>
            只记录已经发生或已确认的变化。人员、时间、归属与版本全部自动生成。
          </p>
        </div>
      </div>
      {/* 设计师稿同页用分段控件筛选记录状态，这里用同一控件切换草稿与正式记录。 */}
      <CalmSegmented
        label="记录视图"
        value={view}
        options={[
          { value: "drafts", label: "草稿" },
          { value: "published", label: "已发布记录" },
        ]}
        onChange={selectView}
      />
      {view === "published" ? <PublishedRecordsView /> : <RecordDraftsView />}
    </div>
  );
}
