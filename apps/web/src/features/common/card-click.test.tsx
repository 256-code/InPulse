import React from "react";
import { createPortal } from "react-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isCardClick } from "./card-click";

const portals: HTMLElement[] = [];

function renderCard(
  onClick: (value: boolean) => void,
  children?: React.ReactNode,
) {
  render(
    <article
      className="project-card"
      tabIndex={0}
      onClick={(event) => onClick(isCardClick(event))}
    >
      <h1>卡片标题</h1>
      {children}
    </article>,
  );
}

afterEach(() => {
  for (const node of portals.splice(0)) node.remove();
});

describe("isCardClick", () => {
  it("treats a click on the card body as a card click", () => {
    const onClick = vi.fn();
    renderCard(onClick);
    fireEvent.click(screen.getByRole("heading", { name: "卡片标题" }));
    expect(onClick).toHaveBeenCalledWith(true);
  });

  it("ignores clicks on buttons and links inside the card", () => {
    const onClick = vi.fn();
    renderCard(
      onClick,
      <>
        <button type="button">编辑</button>
        <a href="/projects/1/modules">查看模块</a>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("link", { name: "查看模块" }));
    expect(onClick).toHaveBeenNthCalledWith(1, false);
    expect(onClick).toHaveBeenNthCalledWith(2, false);
  });

  it("ignores clicks that reach the card from a portal rendered elsewhere", () => {
    const onClick = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    portals.push(host);
    renderCard(onClick, createPortal(<p>弹层内容</p>, host));
    fireEvent.click(host.querySelector("p")!);
    expect(onClick).toHaveBeenCalledWith(false);
  });

  it("ignores non-primary buttons and modified clicks", () => {
    const onClick = vi.fn();
    renderCard(onClick);
    const heading = screen.getByRole("heading", { name: "卡片标题" });
    fireEvent.click(heading, { button: 1 });
    fireEvent.click(heading, { ctrlKey: true });
    fireEvent.click(heading, { metaKey: true });
    expect(onClick).toHaveBeenNthCalledWith(1, false);
    expect(onClick).toHaveBeenNthCalledWith(2, false);
    expect(onClick).toHaveBeenNthCalledWith(3, false);
  });
});
