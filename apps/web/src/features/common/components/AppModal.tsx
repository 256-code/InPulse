import { Modal, type ModalProps } from "antd";
import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";

import { InpulseIcon } from "./InpulseIcon";

/**
 * 弹层宽度分档，与设计系统 `design-system.css` 的
 * `.surface-modal-md` / `-lg` / `-xl` 一一对应。
 *
 * 宽度只能由类名下发。antd 会把 `width` 写成 `.ant-modal` 的行内样式，
 * 优先级高于任何类规则，所以这里不接受 antd 的 `width`。
 */
export type ModalWidth = "md" | "lg" | "xl";

const WIDTH_CLASS: Record<ModalWidth, string> = {
  md: "surface-modal-md",
  lg: "surface-modal-lg",
  xl: "surface-modal-xl",
};

/** 复刻 `<dialog>.showModal()` 的初始焦点：落到盒内第一个可聚焦元素。 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export interface AppModalProps extends Omit<
  ModalProps,
  "width" | "centered" | "footer"
> {
  /** 宽度分档。默认 `md`，对应设计稿的新建项目、模块/功能编辑与各类操作弹层。 */
  readonly size?: ModalWidth;
  /**
   * 无障碍名称。不传时取 `title`、再取 `eyebrow` 的字符串值。
   * 供自渲 `.drawer-header` 的弹层（任务详情等）单独指定 `role="dialog"` 的名字。
   */
  readonly label?: string;
  /** 头部小标题，渲染为设计契约的 `.detail-label`（如「项目名 / 模块名」）。 */
  readonly eyebrow?: ReactNode;
  /** 关闭按钮的无障碍标签；设计稿按场景给出「关闭」「关闭任务详情」等文案。 */
  readonly closeLabel?: string;
  /**
   * 把 `children` 包进带内边距与滚动的 `.modal-body`。
   * 弹层内已自带 `.catalog-form` / `.dialog-form` / `.task-modal-*` 等正文容器时不要开启。
   */
  readonly body?: boolean;
  /**
   * 弹层底部的操作区。设计稿里它是盒子的直接子级 `.calm-action-footer`，
   * 所以不接受 antd 的函数式 `footer`，也不再走 antd 的原生 footer。
   */
  readonly footer?: ReactNode;
}

function mergeClass(...names: (string | undefined)[]): string {
  const classes = new Set<string>();
  for (const name of names) {
    for (const part of (name ?? "").split(/\s+/)) {
      if (part.length > 0) classes.add(part);
    }
  }
  return [...classes].join(" ");
}

function labelOf(
  label: string | undefined,
  eyebrow: ReactNode,
  title: ReactNode,
): string | undefined {
  if (typeof label === "string" && label.trim().length > 0) return label;
  for (const candidate of [title, eyebrow]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * 仓库统一弹层入口，结构照抄设计稿 `surface-modal.tsx`：用 `modalRender` 顶掉
 * antd 的 header/body/footer，让 `.catalog-modal > .drawer-header`、
 * `.task-modal > .calm-tabs`、`.catalog-modal .dialog-form` 这些设计系统的子选择器
 * 直接命中盒子的子元素——多包一层 antd 容器它们会全部失配。
 * `modalRender` 只多插一层 `.ant-modal-render`，由 `antd-adapter.css` 抹平。
 *
 * 同时复刻 `<dialog>.showModal()` 的两件事：① 打开时聚焦盒内第一个可聚焦元素，
 * 关闭后把焦点还给触发元素；② 只锁 `body` 的 `overflow`，不用 antd 的 `scrollLock`
 * ——它会给 body 补 `width: calc(100% - 15px)`，把背景布局挤窄 15px。
 *
 * 垂直居中由 `.surface-modal` 的 `position: fixed; inset: 0; margin: auto` 承担，
 * 因此 `centered` 与 `top` 都不再有意义；`title` 只用于头部排版，不再下发给 antd。
 *
 * antd 给 `.ant-modal` 挂了 `pointer-events: none`，只在它自己的 `.ant-modal-container`
 * 上还原；`modalRender` 绕开了那个容器，所以盒子必须自己带行内 `pointer-events: auto`，
 * 否则弹层在缺 CSS 的环境（jsdom 单测）里整块点不动。
 *
 * `footer` 不再交给 antd（原生 footer 会被顶掉），而是渲染成设计契约的
 * `.calm-action-footer`，与 `.catalog-form`、正文容器并列成为盒子的直接子级。
 */
export function AppModal({
  size = "md",
  label,
  eyebrow,
  closeLabel = "关闭",
  body = false,
  footer,
  title,
  closable,
  className,
  rootClassName,
  wrapClassName,
  open,
  onCancel,
  mask,
  maskClosable,
  children,
  ...props
}: AppModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  const active = open === true;
  const maskConfig = typeof mask === "object" ? mask : undefined;
  const dismissable = (maskConfig?.closable ?? maskClosable) !== false;
  const canDismiss = closable !== false && dismissable;
  const hasHeader = eyebrow !== undefined || title !== undefined;
  // antd 6 已废弃 `maskClosable`，统一归一成 `mask.closable` 再下发。
  const mergedMask =
    typeof mask === "boolean" ? mask : { ...maskConfig, closable: dismissable };

  useEffect(() => {
    if (!active) return;
    const box = boxRef.current;
    const prior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    box?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (prior?.isConnected) prior.focus({ preventScroll: true });
    };
  }, [active]);

  const dismiss = (event: MouseEvent<HTMLElement>) => {
    cancel.current?.(
      event as unknown as Parameters<NonNullable<ModalProps["onCancel"]>>[0],
    );
  };
  // antd 的 `onCancel` 是必填项，而调用方可以不传（纯展示弹层），
  // 所以在 `exactOptionalPropertyTypes` 下必须兜一个稳定函数。
  const dismissRef = useRef<ModalProps["onCancel"]>(undefined);
  dismissRef.current = onCancel;
  const notifyCancel: NonNullable<ModalProps["onCancel"]> = (event) => {
    dismissRef.current?.(event);
  };

  return (
    <Modal
      {...props}
      open={active}
      footer={null}
      closable={false}
      scrollLock={false}
      focusable={{ focusTriggerAfterClose: false }}
      className="surface-modal-dialog"
      rootClassName={mergeClass("surface-modal-root", rootClassName)}
      wrapClassName={mergeClass("surface-modal-wrap", wrapClassName)}
      mask={mergedMask}
      onCancel={notifyCancel}
      modalRender={() => (
        <div
          ref={boxRef}
          className={mergeClass("surface-modal", WIDTH_CLASS[size], className)}
          style={{ pointerEvents: "auto" }}
          role="dialog"
          aria-modal="true"
          aria-label={labelOf(label, eyebrow, title)}
          onClick={(event) => {
            // 设计稿里点击盒子自身的留白（不是子元素）也会关闭。
            if (canDismiss && event.target === boxRef.current) {
              dismiss(event);
            }
          }}
        >
          {hasHeader ? (
            <div className="drawer-header">
              <div>
                {eyebrow === undefined ? null : (
                  <span className="detail-label">{eyebrow}</span>
                )}
                {title === undefined ? null : <h2>{title}</h2>}
              </div>
              {closable === false ? null : (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={closeLabel}
                  onClick={dismiss}
                >
                  <InpulseIcon name="x" size={19} />
                </button>
              )}
            </div>
          ) : null}
          {body ? <div className="modal-body">{children}</div> : children}
          {footer === undefined || footer === null ? null : (
            <div className="calm-action-footer">{footer}</div>
          )}
        </div>
      )}
    >
      {null}
    </Modal>
  );
}
