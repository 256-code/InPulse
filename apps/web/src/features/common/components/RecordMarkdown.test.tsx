import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecordMarkdown, recordLinkHref } from "./RecordMarkdown";

describe("记录正文 Markdown 白名单渲染（B-5）", () => {
  it("renders the CommonMark structures used by record content", () => {
    const { container } = render(
      <RecordMarkdown
        content={"# 标题\n\n**加粗** 与 `code`\n\n- 第一条\n- 第二条\n\n> 引用"}
      />,
    );
    expect(container.querySelector("h1")).toHaveTextContent("标题");
    expect(container.querySelector("strong")).toHaveTextContent("加粗");
    expect(container.querySelector("code")).toHaveTextContent("code");
    expect(
      Array.from(container.querySelectorAll("li")).map(
        (node) => node.textContent,
      ),
    ).toEqual(["第一条", "第二条"]);
    expect(container.querySelector("blockquote")).toHaveTextContent("引用");
  });

  it("keeps raw HTML inert: script, tags and handlers never reach the DOM", () => {
    const { container } = render(
      <RecordMarkdown
        content={
          "<script>window.__b5Xss = 1</script>\n\n" +
          '<img src="x" onerror="window.__b5Xss = 1">\n\n' +
          '<a href="javascript:window.__b5Xss = 1">点我</a>'
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(
      (window as unknown as { __b5Xss?: unknown }).__b5Xss,
    ).toBeUndefined();
    // 原始 HTML 不解析：标签本身被丢弃，纯文本信息保留。
    expect(container.textContent).not.toContain("<script>");
    expect(container.textContent).not.toContain("window.__b5Xss");
    expect(container.textContent).toContain("点我");
  });

  it("keeps tags written inside inline code visible as text", () => {
    const { container } = render(
      <RecordMarkdown content={"把 `<div>` 换成语义化标签"} />,
    );
    expect(container.querySelector("code")).toHaveTextContent("<div>");
    expect(container.textContent).toContain("换成语义化标签");
  });

  it("rejects dangerous URL protocols in markdown links", () => {
    const { container } = render(
      <RecordMarkdown
        content={
          "[javascript](javascript:alert(1))\n\n" +
          "[data](data:text/html;base64,PHNjcmlwdD4=)\n\n" +
          "[vbscript](vbscript:msgbox(1))"
        }
      />,
    );
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("javascript");
    expect(container.textContent).toContain("vbscript");
  });

  it("renders https://github.com links as safe external links", () => {
    const { container } = render(
      <RecordMarkdown content="[PR 128](https://github.com/256-code/InPulse/pull/128)" />,
    );
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/256-code/InPulse/pull/128",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("applies the same whitelist to autolinks", () => {
    const allowed = render(
      <RecordMarkdown content="<https://github.com/256-code/InPulse>" />,
    );
    expect(allowed.container.querySelector("a")).toHaveAttribute(
      "href",
      "https://github.com/256-code/InPulse",
    );
    const blocked = render(
      <RecordMarkdown content="<https://evil.example/track>" />,
    );
    expect(blocked.container.querySelector("a")).toBeNull();
  });

  it("keeps non-GitHub, non-HTTPS and malformed links as plain text", () => {
    for (const item of [
      "[a](http://github.com/256-code/InPulse)",
      "[b](https://evil.example/pull/1)",
      "[c](https://github.com.evil.example/pull/1)",
      "[d](https://user:pass@github.com/pull/1)",
      "[e](https://github.com:8443/pull/1)",
      "[f](https://api.github.com/repos/256-code/InPulse)",
      "[g](//github.com/256-code/InPulse)",
      "[h](/projects/3)",
    ]) {
      const { container, unmount } = render(<RecordMarkdown content={item} />);
      expect(container.querySelector("a")).toBeNull();
      expect(container.textContent?.trim()).not.toBe("");
      unmount();
    }
  });

  it("does not load remote images and keeps only the alt text", () => {
    const { container } = render(
      <RecordMarkdown content="![跟踪像素](https://evil.example/track.png)" />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[图片：跟踪像素]");
  });

  it("appends caller class names and renders empty content without nodes", () => {
    const { container } = render(
      <RecordMarkdown content="" className="record-markdown-inline" />,
    );
    expect(
      container.querySelector(".record-markdown.record-markdown-inline"),
    ).not.toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("记录正文链接白名单 recordLinkHref（B-5）", () => {
  it("会规范化放行 GitHub HTTPS 链接", () => {
    expect(
      recordLinkHref(" https://github.com/256-code/InPulse/pull/128 "),
    ).toBe("https://github.com/256-code/InPulse/pull/128");
    expect(recordLinkHref("https://GitHub.com/256-code/InPulse")).toBe(
      "https://github.com/256-code/InPulse",
    );
    expect(recordLinkHref("https://github.com/256-code/InPulse#L10")).toBe(
      "https://github.com/256-code/InPulse#L10",
    );
  });

  it("会拒绝空值、畸形输入与白名单之外的地址", () => {
    for (const raw of [
      "",
      "   ",
      "github.com/256-code/InPulse",
      "http://github.com/256-code/InPulse",
      "ftp://github.com/256-code/InPulse",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://api.github.com/repos/256-code/InPulse",
      "https://github.com.evil.example/x",
      "https://user@github.com/x",
      "https://github.com:8443/x",
    ])
      expect(recordLinkHref(raw)).toBeNull();
  });
});
