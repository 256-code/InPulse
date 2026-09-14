import type { ThemeConfig } from "antd";

/**
 * Ant Design 主题令牌，取值全部来自 `styles/design-system.css` 的 `:root`，
 * 保证 antd 组件默认态与既有设计系统一致（外观零差异是硬约束）。
 */
export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1467d8",
    colorLink: "#1467d8",
    colorInfo: "#1467d8",
    colorSuccess: "#4a9278",
    // 原型里危险色只有一处取值：`.danger-button` / `.danger-text` / `due-overdue` 都用 `#c0453f`。
    colorError: "#c0453f",
    colorWarning: "#c9821a",
    colorText: "#132238",
    colorTextSecondary: "#5d7288",
    colorTextTertiary: "#8492a1",
    colorTextQuaternary: "#a0adb9",
    colorBgBase: "#ffffff",
    colorBgLayout: "#f4f7fb",
    colorBorder: "#e1e8f0",
    colorBorderSecondary: "#edf1f5",
    colorFillQuaternary: "#f4f7fb",
    borderRadius: 9,
    borderRadiusSM: 6,
    borderRadiusLG: 11,
    fontSize: 13,
    fontFamily: 'Arial, "Microsoft YaHei", sans-serif',
    controlHeight: 32,
    lineWidth: 1,
    motion: false,
    wireframe: false,
    boxShadow: "0 18px 46px #16324d2e",
    boxShadowSecondary: "0 18px 46px #16324d2e",
  },
  components: {
    Modal: {
      borderRadiusLG: 16,
      padding: 0,
      paddingContentHorizontalLG: 0,
      boxShadow: "0 28px 90px #10253e40",
    },
    Segmented: {
      trackBg: "#e9eff5",
      itemColor: "#7c8c9e",
      itemSelectedBg: "#ffffff",
      itemSelectedColor: "#276db3",
      borderRadius: 6,
      borderRadiusSM: 4,
      fontSize: 13,
    },
    Checkbox: { borderRadiusSM: 3, colorPrimary: "#1467d8" },
    Select: {
      optionSelectedBg: "#eef4fc",
      optionSelectedColor: "#1467d8",
      borderRadius: 6,
    },
    DatePicker: { borderRadius: 6 },
    Tabs: {
      inkBarColor: "#1467d8",
      itemColor: "#6c8094",
      itemSelectedColor: "#1467d8",
      horizontalItemGutter: 24,
    },
    Tooltip: { colorBgSpotlight: "#243b53", borderRadius: 6 },
    Dropdown: { borderRadiusLG: 11, paddingBlock: 6 },
  },
};
