import React from "react";
import { CalmSectionTitle } from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { notificationScenarios } from "./settings-content";

/**
 * 设计师稿 latest-version/views/settings.tsx L216-239：通知策略区块。
 * 通知偏好属于后续版本，这里按设计稿只给出只读策略表。
 */
export const NotificationPolicyPanel: React.FC = () => {
  return (
    <section className="panel settings-panel table-panel" aria-label="通知策略">
      <CalmSectionTitle
        title="通知策略"
        hint="只通知需要采取行动或关注结果的人"
      />

      <div className="table-wrap">
        <table className="settings-table">
          <caption className="sr-only">通知场景</caption>
          <thead>
            <tr>
              <th scope="col">事件</th>
              <th scope="col">通知对象</th>
            </tr>
          </thead>
          <tbody>
            {notificationScenarios.map((row) => (
              <tr key={row.event}>
                <td>
                  <strong>{row.event}</strong>
                </td>
                <td>{row.audience}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="permission-note">
        <InpulseIcon name="bell" size={17} />
        <span>
          <strong>展示方式</strong>
          左侧导航底部的铃铛在收到未读通知时显示红点，悬停可看到未读条数；点击铃铛展开通知中心，点开单条通知会直达对应的任务、迭代记录或项目动态。
        </span>
      </div>
    </section>
  );
};

export default NotificationPolicyPanel;
