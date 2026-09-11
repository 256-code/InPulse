import React from "react";
import { CalmBadge, CalmSectionTitle } from "@features/common/components/Calm";
import { permissionMatrixRows } from "./settings-content";

/**
 * 设计师稿 latest-version/views/settings.tsx L187-214：权限矩阵区块。
 * 只渲染只读说明表，任何鉴权判断都在服务端完成。
 */
export const PermissionMatrixPanel: React.FC = () => (
  <section className="settings-panel table-panel" aria-label="权限矩阵">
    <CalmSectionTitle
      title="权限矩阵"
      hint="V1.1 授权验收入口 · 与功能设计 §8.2 一致"
    />

    <div className="table-wrap">
      <table className="settings-table">
        <caption className="sr-only">权限矩阵</caption>
        <thead>
          <tr>
            <th scope="col">功能</th>
            <th scope="col">系统管理员</th>
            <th scope="col">项目成员</th>
            <th scope="col">规则说明</th>
          </tr>
        </thead>
        <tbody>
          {permissionMatrixRows.map((row) => (
            <tr key={row.feature}>
              <td>
                <strong>{row.feature}</strong>
              </td>
              <td className="permission-cell">
                {row.admin ? (
                  <CalmBadge tone="green">√</CalmBadge>
                ) : (
                  <CalmBadge tone="gray">—</CalmBadge>
                )}
              </td>
              <td className="permission-cell">
                {row.member ? (
                  <CalmBadge tone="green">√</CalmBadge>
                ) : (
                  <CalmBadge tone="gray">—</CalmBadge>
                )}
              </td>
              <td>
                <small>{row.note}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

export default PermissionMatrixPanel;
