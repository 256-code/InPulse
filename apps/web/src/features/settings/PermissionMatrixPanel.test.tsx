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
    expect(cell("归档/恢复项目", 1)).toHaveTextContent("√");
    expect(cell("归档/恢复项目", 2)).toHaveTextContent("—");
    expect(cell("归档/恢复项目", 3)).toHaveTextContent("高风险权限");
  });

  it("keeps immutable and out-of-scope capabilities unavailable to everyone", () => {
    render(<PermissionMatrixPanel />);
    for (const row of ["修改项目编码", "配置 GitHub 应用或 Token"]) {
      expect(cell(row, 1)).toHaveTextContent("—");
      expect(cell(row, 2)).toHaveTextContent("—");
    }
    expect(cell("配置 GitHub 应用或 Token", 3)).toHaveTextContent(
      "V1.1 不接入 GitHub API，也不持有 Token",
    );
  });

  it("states the source of truth for authorization in the panel header", () => {
    render(<PermissionMatrixPanel />);
    expect(
      screen.getByText("V1.1 授权验收入口 · 与功能设计 §8.2 一致"),
    ).toBeInTheDocument();
  });
});
