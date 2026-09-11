import React, { useState } from "react";
import { CalmSectionTitle } from "@features/common/components/Calm";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { notificationScenarios } from "./settings-content";

/**
 * 设计师稿 latest-version/views/settings.tsx L216-239：通知策略区块。
 * 通知偏好本身属于后续版本，这里按设计稿给出只读策略表与入口说明。
 */
export const NotificationPolicyPanel: React.FC = () => {
  const [preferenceHint, setPreferenceHint] = useState(false);

  return (
    <section className="settings-panel table-panel" aria-label="通知策略">
      <CalmSectionTitle
        title="通知策略"
        hint="只通知需要采取行动或关注结果的人"
      >
        <button
          type="button"
          className="secondary-button"
          onClick={() => setPreferenceHint(true)}
        >
          <InpulseIcon name="bell" size={15} />
          通知偏好
        </button>
      </CalmSectionTitle>

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
          顶部导航铃铛显示未读数量，点击通知直接跳转到对应任务、功能或迭代记录。
        </span>
      </div>

      {preferenceHint ? (
        <div className="permission-note" role="status">
          <InpulseIcon name="bell" size={16} />
          <span>通知偏好设置将在正式版本提供，当前使用固定通知策略。</span>
        </div>
      ) : null}
    </section>
  );
};

export default NotificationPolicyPanel;
