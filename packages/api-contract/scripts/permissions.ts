import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { repositoryRoot } from "../src/artifacts.js";
import { validatePermissionMatrix } from "../src/permission-checks.js";
import { permissionMatrix } from "../src/permission-matrix.js";
import { routeRegistry } from "../src/route-registry.js";
import { reportFindings } from "./report.js";

const permissionsDocument = await readFile(
  resolve(repositoryRoot, "docs/permissions.md"),
  "utf8",
);

const findings = validatePermissionMatrix({
  routes: routeRegistry,
  matrix: permissionMatrix,
  permissionsDocument,
});

process.exitCode = reportFindings(
  `权限矩阵（${permissionMatrix.length} 条操作 / ${routeRegistry.length} 条路由）`,
  findings,
);
