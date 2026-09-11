#!/usr/bin/env node

// 依赖边界门禁（AGENTS.md 第 3 节 / 技术设计 12.4）：
// - 前端 app -> pages -> features -> shared/generated，禁止反向与跨层；
// - 后端 Controller 不得直接访问数据库，领域模块只能经公开表面（public/**、
//   模块 index.ts、*.port.ts）跨模块，对应 AGENTS.md 第 3 节的 Domain/Public Port；
// - 禁止循环依赖；
// - 前端业务代码不得裸写 fetch/axios，必须使用生成客户端。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".cjs", ".js"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "coverage", ".git"]);
const SCAN_ROOTS = [
  "apps/api/src",
  "apps/ops/src",
  "apps/ops/test",
  "apps/e2e",
  "apps/web/src",
  "packages/api-contract/src",
  "packages/api-contract/scripts",
  "packages/api-contract/test",
  "packages/canonical-json/src",
  "packages/canonical-json/test",
  "packages/eslint-config",
  "database/src",
  "database/schema",
  "database/test",
  "database/poc",
];

const WEB_LAYERS = ["app", "pages", "features", "shared", "generated"];
const IMPORT_PATTERNS = [
  /import\s+[^"'()]*?from\s*["']([^"']+)["']/g,
  /import\s*["']([^"']+)["']/g,
  /export\s+[^"'()]*?from\s*["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const FETCH_PATTERN = /(?<![A-Za-z0-9_$.])fetch\s*\(/g;

const problems = [];

function fail(file, line, rule, message) {
  problems.push(
    `${relative(file)}${line ? `:${line}` : ""}: [${rule}] ${message}`,
  );
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix);
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

async function collectFiles(directory) {
  const files = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = path.resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...(await collectFiles(full)));
      continue;
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    files.push(full);
  }
  return files.sort();
}

function workspacePackages() {
  return {
    "@inpulse/api-contract": path.resolve(
      ROOT,
      "packages/api-contract/src/index.ts",
    ),
    "@inpulse/canonical-json": path.resolve(
      ROOT,
      "packages/canonical-json/src/index.ts",
    ),
    "@inpulse/database": path.resolve(ROOT, "database/schema/index.ts"),
    "@inpulse/eslint-config": path.resolve(
      ROOT,
      "packages/eslint-config/index.mjs",
    ),
  };
}

async function resolveSpecifier(specifier, fromFile, packages) {
  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(fromFile), specifier);
    const candidates = [base];
    if (specifier.endsWith(".js")) {
      candidates.push(`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`);
    }
    for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
      candidates.push(`${base}${extension}`);
    }
    for (const index of ["index.ts", "index.tsx", "index.mjs"]) {
      candidates.push(path.resolve(base, index));
    }
    for (const candidate of candidates) {
      try {
        const stats = await readFile(candidate, "utf8");
        if (typeof stats === "string") return candidate;
      } catch {
        // 继续尝试下一个候选路径
      }
    }
    return undefined;
  }
  if (specifier.startsWith("@inpulse/")) {
    const entry = packages[specifier.split("/").slice(0, 2).join("/")];
    return entry;
  }
  return undefined;
}

function describe(file) {
  const local = relative(file);
  if (local.startsWith("apps/web/")) {
    const segments = local.split("/");
    const layerIndex = segments.indexOf("src");
    const layer = segments[layerIndex + 1];
    const resolvedLayer = WEB_LAYERS.includes(layer) ? layer : "app";
    return { area: "web", layer: resolvedLayer, local };
  }
  if (local.startsWith("apps/api/")) {
    return { area: "api", local };
  }
  if (local.startsWith("apps/ops/")) {
    return { area: "ops", local };
  }
  if (local.startsWith("packages/api-contract/")) {
    return { area: "contract", local };
  }
  if (local.startsWith("packages/canonical-json/")) {
    return { area: "canonical-json", local };
  }
  if (local.startsWith("packages/eslint-config/")) {
    return { area: "eslint-config", local };
  }
  if (local.startsWith("database/")) {
    return { area: "database", local };
  }
  return { area: "other", local };
}

function checkEdge(source, target, sourceFile, line, external) {
  if (external) {
    if (source.area === "web" && external === "@inpulse/database") {
      fail(sourceFile, line, "frontend-database", "前端禁止导入数据库 Schema");
    }
    if (isControllerDatabaseAccess(source, sourceFile, external, undefined)) {
      fail(
        sourceFile,
        line,
        "controller-database",
        `Controller 不得直接依赖 ${external}，必须经 Application Service/Workflow 与 Repository`,
      );
    }
    return;
  }

  if (isControllerDatabaseAccess(source, sourceFile, undefined, target)) {
    fail(
      sourceFile,
      line,
      "controller-database",
      `Controller 不得直接访问数据库层 ${target.local}，必须经 Application Service/Workflow 与 Repository`,
    );
  }

  if (
    source.area === "web" &&
    target.area !== "web" &&
    target.area !== "contract"
  ) {
    fail(sourceFile, line, "frontend-boundary", `前端不得依赖 ${target.local}`);
  }
  if (source.area === "api" && target.area === "web") {
    fail(
      sourceFile,
      line,
      "backend-boundary",
      `API 不得依赖前端 ${target.local}`,
    );
  }
  if (
    source.area === "database" &&
    (target.area === "api" ||
      target.area === "web" ||
      target.area === "contract")
  ) {
    fail(
      sourceFile,
      line,
      "database-boundary",
      `database 不得依赖应用层 ${target.local}`,
    );
  }
  if (
    source.area === "contract" &&
    (target.area === "api" || target.area === "web")
  ) {
    fail(
      sourceFile,
      line,
      "contract-boundary",
      `契约包不得依赖应用 ${target.local}`,
    );
  }

  if (source.area === "web" && target.area === "web") {
    const sourceRank = WEB_LAYERS.indexOf(source.layer);
    const targetRank = WEB_LAYERS.indexOf(target.layer);
    if (targetRank < sourceRank) {
      fail(
        sourceFile,
        line,
        "web-layer",
        `${source.layer} 不得反向依赖 ${target.layer}（允许方向 app -> pages -> features -> shared/generated）`,
      );
    }
  }

  const sourceModule = apiModuleOf(source.local);
  const targetModule = apiModuleOf(target.local);
  if (sourceModule && targetModule && sourceModule !== targetModule) {
    if (!isModulePublicSurface(target.local, targetModule)) {
      fail(
        sourceFile,
        line,
        "module-boundary",
        `模块 ${sourceModule} 不得访问模块 ${targetModule} 的内部实现 ${target.local}`,
      );
    }
  }
}

const DATABASE_DEPENDENCY_DENIED_FOR_CONTROLLERS = [
  "@inpulse/database",
  "drizzle-orm",
  "postgres",
];

function isControllerDatabaseAccess(source, sourceFile, external, target) {
  if (source.area !== "api" || !sourceFile.endsWith(".controller.ts")) {
    return false;
  }
  if (external) {
    return DATABASE_DEPENDENCY_DENIED_FOR_CONTROLLERS.includes(external);
  }
  return target?.area === "database";
}

function apiModuleOf(local) {
  const match = local.match(/apps\/api\/src\/modules\/([^/]+)\//);
  return match ? match[1] : undefined;
}

// AGENTS.md 第 3 节：跨域读只允许通过稳定 QueryPort，跨域写只允许 Workflow 调用
// 公开 CommandPort。因此一个模块的公开表面是 public/**、模块 index.ts 与模块根目录
// 下的 *.port.ts；其余文件都属于模块内部实现，不得被其他模块导入。
// Port 文件自身也作为来源被扫描，因此它再伸手进别的模块内部同样会被拒绝。
function isModulePublicSurface(local, moduleName) {
  const prefix = `apps/api/src/modules/${moduleName}/`;
  if (!local.startsWith(prefix)) return false;
  const relative = local.slice(prefix.length);
  if (relative.startsWith("public/")) return true;
  if (relative === "index.ts") return true;
  return !relative.includes("/") && relative.endsWith(".port.ts");
}

function checkFetchUsage(source, sourceFile, descriptor) {
  if (descriptor.area !== "web" || descriptor.layer === "generated") return;
  const withoutImports = source.replace(/import[^;]*;?/g, "");
  for (const match of withoutImports.matchAll(FETCH_PATTERN)) {
    fail(
      sourceFile,
      lineOf(withoutImports, match.index),
      "generated-client",
      "业务代码不得裸写 fetch，必须使用 apps/web/src/generated/api 的生成客户端",
    );
  }
  if (/from\s+["']axios["']/.test(source)) {
    fail(
      sourceFile,
      0,
      "generated-client",
      "禁止引入 axios，必须使用生成客户端",
    );
  }
}

function findCycles(edges) {
  const cycles = [];
  const state = new Map();
  const stack = [];

  const visit = (node) => {
    const current = state.get(node);
    if (current === "done") return;
    if (current === "active") {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node].map(relative).join(" -> "));
      return;
    }
    state.set(node, "active");
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      visit(next);
    }
    stack.pop();
    state.set(node, "done");
  };

  for (const node of [...edges.keys()].sort()) {
    visit(node);
  }
  return [...new Set(cycles)];
}

async function main() {
  const packages = workspacePackages();
  const files = [];
  for (const scanRoot of SCAN_ROOTS) {
    files.push(...(await collectFiles(path.resolve(ROOT, scanRoot))));
  }

  const edges = new Map();
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    const source = stripComments(raw);
    const descriptor = describe(file);
    checkFetchUsage(source, file, descriptor);

    const targets = new Set();
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const specifier = match[1];
        const line = lineOf(source, match.index);
        const resolved = await resolveSpecifier(specifier, file, packages);
        if (!resolved) {
          checkEdge(descriptor, undefined, file, line, specifier);
          continue;
        }
        if (resolved === file) continue;
        targets.add(resolved);
        checkEdge(descriptor, describe(resolved), file, line, undefined);
      }
    }
    edges.set(file, [...targets].sort());
  }

  for (const cycle of findCycles(edges)) {
    problems.push(`[circular-dependency] ${cycle}`);
  }

  if (problems.length > 0) {
    console.error("依赖边界检查失败：");
    for (const problem of [...new Set(problems)].sort()) {
      console.error(`- ${problem}`);
    }
    return 1;
  }
  console.log(
    `依赖边界检查通过：${files.length} 个源文件，${edges.size} 个模块节点，无循环依赖与越界导入。`,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(
    `依赖边界检查失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
