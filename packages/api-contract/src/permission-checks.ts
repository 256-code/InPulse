import {
  outcomeAllows,
  outcomeDenies,
  permissionIdentities,
  type PermissionMatrixEntry,
} from "./permission-matrix.js";
import type { RouteDefinition } from "./route-registry.js";
import { securityFlowOperationIds } from "./security-flow.js";
import type { Finding } from "./validate.js";

/**
 * 从 docs/permissions.md 的“身份定义”表解析身份集合，
 * 保证可执行权限矩阵与设计文档不漂移。
 */
export function parseIdentityTable(markdown: string): readonly string[] {
  const section = sliceSection(markdown, "## 身份定义");
  const identities: string[] = [];
  for (const line of section) {
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const first = cells[1] ?? "";
    if (first.length === 0 || first === "身份" || /^-+$/.test(first)) {
      continue;
    }
    identities.push(first);
  }
  return identities;
}

/**
 * 从 docs/permissions.md 的“认证安全流程矩阵”解析 operationId 列，
 * 与 ADR-023 allowlist 精确比对。
 */
export function parseSecurityFlowOperationIds(
  markdown: string,
): readonly string[] {
  const section = sliceSection(markdown, "## 认证安全流程矩阵");
  const ids: string[] = [];
  for (const line of section) {
    if (!line.startsWith("|")) {
      continue;
    }
    const cells = line.split("|").map((cell) => cell.trim());
    const first = cells[1] ?? "";
    const match = first.match(/^`([A-Za-z][A-Za-z0-9]*)`$/);
    if (match) {
      ids.push(match[1]!);
    }
  }
  return ids;
}

function sliceSection(markdown: string, heading: string): readonly string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    throw new Error(`docs/permissions.md 缺少章节：${heading}`);
  }
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s/.test(line),
  );
  return lines.slice(start + 1, end < 0 ? lines.length : end);
}

export interface PermissionMatrixInput {
  readonly routes: readonly RouteDefinition[];
  readonly matrix: readonly PermissionMatrixEntry[];
  readonly permissionsDocument: string;
}

/**
 * 测试矩阵 AUTHZ-001 / ADR-019：Route Registry 与可执行权限矩阵一一对应，
 * 身份集合与文档一致，需认证的路由必须同时存在允许与拒绝用例。
 */
export function validatePermissionMatrix(
  input: PermissionMatrixInput,
): Finding[] {
  const findings: Finding[] = [];
  const add = (rule: string, operationId: string, message: string): void => {
    findings.push({ rule, operationId, message });
  };

  const documentedIdentities = parseIdentityTable(input.permissionsDocument);
  const codeIdentities: readonly string[] = [...permissionIdentities];
  const missingInCode = documentedIdentities.filter(
    (identity) => !codeIdentities.includes(identity),
  );
  const extraInCode = codeIdentities.filter(
    (identity) => !documentedIdentities.includes(identity),
  );
  if (missingInCode.length > 0 || extraInCode.length > 0) {
    add(
      "permission-identities",
      "-",
      `身份集合与 docs/permissions.md 不一致：缺少 [${missingInCode.join(", ")}]，多余 [${extraInCode.join(", ")}]`,
    );
  }

  const documentedFlows = parseSecurityFlowOperationIds(
    input.permissionsDocument,
  );
  const allowlist: readonly string[] = [...securityFlowOperationIds];
  const flowMissingInDoc = allowlist.filter(
    (id) => !documentedFlows.includes(id),
  );
  const flowExtraInDoc = documentedFlows.filter(
    (id) => !allowlist.includes(id),
  );
  if (flowMissingInDoc.length > 0 || flowExtraInDoc.length > 0) {
    add(
      "security-flow-allowlist",
      "-",
      `ADR-023 allowlist 与权限矩阵文档不精确相等：文档缺少 [${flowMissingInDoc.join(", ")}]，文档多余 [${flowExtraInDoc.join(", ")}]`,
    );
  }

  const entriesByOperation = new Map<string, PermissionMatrixEntry>();
  for (const entry of input.matrix) {
    if (entriesByOperation.has(entry.operationId)) {
      add("permission-matrix", entry.operationId, "权限矩阵条目重复");
    }
    entriesByOperation.set(entry.operationId, entry);
    const declared = Object.keys(entry.outcomes).sort();
    const expected = [...documentedIdentities].sort();
    if (declared.join(",") !== expected.join(",")) {
      add(
        "permission-matrix",
        entry.operationId,
        `身份覆盖 [${declared.join(", ")}] 必须与文档身份集合 [${expected.join(", ")}] 精确一致`,
      );
    }
  }

  for (const route of input.routes) {
    const entry = entriesByOperation.get(route.operationId);
    if (!entry) {
      add(
        "permission-matrix",
        route.operationId,
        "ADR-019：Route Registry 中每条路由都必须有权限矩阵条目",
      );
      continue;
    }
    const outcomes = Object.values(entry.outcomes);
    if (route.authPolicy === "none") {
      const denied = outcomes.filter((outcome) => outcome.kind !== "allow");
      if (denied.length > 0) {
        add(
          "permission-matrix",
          route.operationId,
          "authPolicy 为 none 的路由必须对全部身份开放，否则必须登记鉴权策略",
        );
      }
      continue;
    }
    if (!outcomes.some(outcomeAllows)) {
      add("permission-matrix", route.operationId, "AUTHZ-001：缺少允许用例");
    }
    if (!outcomes.some(outcomeDenies)) {
      add("permission-matrix", route.operationId, "AUTHZ-001：缺少拒绝用例");
    }
    if (
      route.idempotencyPolicy === "securityFlow" &&
      !documentedFlows.includes(route.operationId)
    ) {
      add(
        "security-flow-allowlist",
        route.operationId,
        "securityFlow 路由必须出现在权限矩阵的认证安全流程矩阵中",
      );
    }
  }

  for (const entry of input.matrix) {
    if (
      !input.routes.some((route) => route.operationId === entry.operationId)
    ) {
      add(
        "permission-matrix",
        entry.operationId,
        "权限矩阵条目没有对应的 Route Registry 路由",
      );
    }
  }

  return findings;
}
