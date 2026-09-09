import type { ThemeConfig } from "antd";

export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: "#1467d8",
    colorLink: "#1467d8",
    colorText: "#132238",
    colorTextSecondary: "#718096",
    colorBgLayout: "#f4f7fb",
    colorBgContainer: "#ffffff",
    colorBorder: "#e1e8f0",
    colorBorderSecondary: "#e1e8f0",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: [
      "-apple-system",
      "BlinkMacSystemFont",
      "'Segoe UI'",
      "Roboto",
      "'Helvetica Neue'",
      "Arial",
      "'Noto Sans'",
      "sans-serif",
      "'Apple Color Emoji'",
      "'Segoe UI Emoji'",
      "'Segoe UI Symbol'",
      "'Noto Color Emoji'",
    ].join(","),
  },
};
