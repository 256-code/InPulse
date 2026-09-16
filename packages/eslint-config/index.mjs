import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "pnpm-lock.yaml",
      // 本地联调用数据目录（如 .data/sso 的 Casdoor 凭据与冒烟脚本）不入版本库，
      // 也不参与 lint 门禁。
      "**/.data/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    languageOptions: { globals: { ...globals.browser } },
  },
];
