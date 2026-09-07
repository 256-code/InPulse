/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "禁止循环依赖",
      from: {},
      to: {
        circular: true,
      },
    },
    {
      name: "pages-not-import-app",
      severity: "error",
      comment: "pages 禁止反向导入 app",
      from: {
        path: "^src/pages",
      },
      to: {
        path: "^src/app",
      },
    },
    {
      name: "features-not-import-app-or-pages",
      severity: "error",
      comment: "features 禁止导入 app 或 pages",
      from: {
        path: "^src/features",
      },
      to: {
        path: "^src/(app|pages)",
      },
    },
    {
      name: "shared-not-import-business",
      severity: "error",
      comment: "shared 禁止反向依赖业务层 (app, pages, features)",
      from: {
        path: "^src/shared",
      },
      to: {
        path: "^src/(app|pages|features)",
      },
    },
    {
      name: "generated-not-import-business",
      severity: "error",
      comment: "generated 禁止反向依赖业务层 (app, pages, features)",
      from: {
        path: "^src/generated",
      },
      to: {
        path: "^src/(app|pages|features)",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "./tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
    },
  },
};
