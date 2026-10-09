import React from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PermissionMatrixPanel } from "./PermissionMatrixPanel";
import { permissionMatrixRows } from "./settings-content";

function cell(rowLabel: string, columnIndex: number): HTMLElement {
  const row = screen.getByText(rowLabel).closest("tr");
  if (!row) throw new Error(`permission row not found: ${rowLabel}`);
  const cells = within(row as HTMLElement).getAllByRole("cell");
  const target = cells[columnIndex];
  if (!target) throw new Error(`column not found: ${columnIndex}`);
  return target;
}

describe("PermissionMatrixPanel", () => {
  it("renders the four documented columns over every matrix row", () => {
    render(<PermissionMatrixPanel />);
    const table = screen.getByRole("table", { name: "权限矩阵" });
    for (const header of ["功能", "系统管理员", "项目成员", "规则说明"]) {
      expect(
        within(table).getByRole("columnheader", { name: header }),
      ).toBeInTheDocument();
    }
    expect(within(table).getAllByRole("row")).toHaveLength(
      permissionMatrixRows.length + 1,
    );
  });

  it("marks high-risk permissions as admin only and keeps their rule note", () => {
    render(<PermissionMatrixPanel />);
    expect(cell("查看所有项目", 1)).toHaveTextContent("√");
    expect(cell("查看所有项目", 2)).toHaveTextContent("—");
    expect(cell("查看所有项目", 3)).toHaveTextContent(
      "项目成员只能看已加入项目",
    );
    expect(cell("用户账号管理", 1)).toHaveTextContent("√");
    expect(cell("用户账号管理", 2)).toHaveTextContent("—");
  });

  it("omits removed and nobody-can-do capabilities and never shows a version tag", () => {
    render(<PermissionMatrixPanel />);
    for (const row of [
      "修改项目编码",
      "配置 GitHub 应用或 Token",
      "归档/恢复项目",
      "归档/恢复模块",
      "归档/恢复功能",
      "彻底删除项目",
      "删除/还原项目",
    ]) {
      expect(screen.queryByText(row)).not.toBeInTheDocument();
    }
    expect(screen.queryAllByText(/V1\.1/)).toHaveLength(0);
  });

  it("describes the panel without any version tag", () => {
    render(<PermissionMatrixPanel />);
    expect(
      screen.getByText("系统管理员与项目成员的权限对照"),
    ).toBeInTheDocument();
  });

  it("distinguishes member-wide, leader-only and admin-only capabilities", () => {
    render(<PermissionMatrixPanel />);
    expect(cell("变更项目状态", 2)).toHaveTextContent("√");
    expect(cell("添加/移除项目成员", 2)).toHaveTextContent("√");
    for (const row of ["组长转移", "删除项目"]) {
      expect(cell(row, 1)).toHaveTextContent("√");
      expect(cell(row, 2)).toHaveTextContent("仅组长");
    }
  });
});
