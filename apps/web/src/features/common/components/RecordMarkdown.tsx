import React from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize, {
  type Options as SanitizeSchema,
} from "rehype-sanitize";
import "./record-markdown.css";

/**
 * B-5：迭代记录正文的 Markdown 白名单渲染。
 *
 * 依据技术设计 §7.5 与系统设计 §3.6：Markdown 保存原文，渲染使用
 * react-markdown + rehype-sanitize，不启用原始 HTML；外链协议仅允许 https，
 * 且只把 GitHub 链接渲染成可点击外链（与 ADR-022 / SEC-004 的外链口径一致，
 * 禁止字符串前缀判断域名），其余链接只保留文本。
 *
 * 安全层次（逐层独立生效，任何一层被误删都不会放开）：
 * 1. react-markdown 不启用原始 HTML，未解析的 HTML 只会以文本输出；
 * 2. rehype-sanitize 用本文件的白名单 schema 收敛标签、属性与协议；
 * 3. urlTransform 与实际渲染前统一走 recordLinkHref，拒绝 http、其他域名、
 *    userinfo、非默认端口与畸形 URL；
 * 4. 图片不加载远程资源（生产 CSP img-src 'self' data: 本已阻断外部图片），
 *    只保留 alt 文本，避免外部请求与追踪像素。
 */

/** rehype-sanitize 白名单：只保留 CommonMark 生成的展示结构。 */
const recordMarkdownSchema: SanitizeSchema = {
  allowComments: false,
  allowDoctypes: false,
  ancestors: {},
  attributes: {
    a: ["href"],
    img: ["alt"],
  },
  clobber: ["ariaDescribedBy", "ariaLabelledBy", "id", "name"],
  clobberPrefix: "user-content-",
  protocols: { href: ["https"] },
  required: {},
  strip: [
    "audio",
    "base",
    "button",
    "canvas",
    "embed",
    "form",
    "frame",
    "frameset",
    "iframe",
    "input",
    "link",
    "math",
    "meta",
    "noscript",
    "object",
    "script",
    "select",
    "source",
    "style",
    "svg",
    "template",
    "textarea",
    "title",
    "track",
    "video",
  ],
  tagNames: [
    "a",
    "blockquote",
    "br",
    "code",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "ul",
  ],
};

/**
 * 记录正文链接白名单：只放行规范化后的 https://github.com/...。
 * 返回 null 表示该地址不产出可点击 href（按纯文本渲染）。
 */
export function recordLinkHref(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  )
    return null;
  return parsed.toString();
}

const recordMarkdownComponents: Components = {
  a: ({ href, children }) => {
    const target = typeof href === "string" ? recordLinkHref(href) : null;
    return target === null ? (
      <>{children}</>
    ) : (
      <a href={target} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  },
  img: ({ alt }) => {
    const text = typeof alt === "string" ? alt.trim() : "";
    return text === "" ? null : (
      <span className="record-markdown-media">[图片：{text}]</span>
    );
  },
};

const transformRecordUrl = (url: string): string => recordLinkHref(url) ?? "";

export interface RecordMarkdownProps {
  /** Markdown 原文；空串由调用方自行提供占位文案。 */
  readonly content: string;
  /** 追加到 .record-markdown 容器上的类名。 */
  readonly className?: string;
}

export const RecordMarkdown: React.FC<RecordMarkdownProps> = ({
  content,
  className,
}) => (
  <div
    className={className ? `record-markdown ${className}` : "record-markdown"}
  >
    <Markdown
      components={recordMarkdownComponents}
      rehypePlugins={[[rehypeSanitize, recordMarkdownSchema]]}
      urlTransform={transformRecordUrl}
    >
      {content}
    </Markdown>
  </div>
);
