import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

import type { Finding } from "./validate.js";
import {
  apiBasePath,
  type HttpMethod,
  type RouteDefinition,
} from "./route-registry.js";

export interface ControllerBinding {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: string;
  readonly operationId: string;
  readonly file: string;
}

export interface ApiScan {
  readonly globalPrefix: string;
  readonly bindings: readonly ControllerBinding[];
  readonly failures: readonly string[];
}

const methodDecorators: Readonly<Record<string, HttpMethod>> = {
  Get: "GET",
  Head: "HEAD",
  Post: "POST",
  Put: "PUT",
  Patch: "PATCH",
  Delete: "DELETE",
};

function joinPath(...segments: readonly string[]): string {
  const cleaned = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment.length > 0);
  return `/${cleaned.join("/")}`;
}

/**
 * 技术设计 4.1.1：Controller 只绑定 operationId。这里静态解析 Nest 装饰器，
 * 证明 Route Registry 与实际注册的路由一一对应；无法解析的写法必须失败，
 * 不允许静默忽略。
 */
export function parseControllerSource(
  source: string,
  file: string,
): { bindings: ControllerBinding[]; failures: string[] } {
  const bindings: ControllerBinding[] = [];
  const failures: string[] = [];

  const controllerMatch = source.match(/@Controller\(([^)]*)\)/);
  if (!controllerMatch) {
    failures.push(`${file}: 缺少 @Controller 装饰器`);
    return { bindings, failures };
  }
  const argument = controllerMatch[1]!.trim();
  let controllerPath = "";
  if (argument.length > 0) {
    const literal =
      argument.match(/^"([^"]*)"$/) ?? argument.match(/^'([^']*)'$/);
    if (!literal) {
      failures.push(
        `${file}: @Controller 参数必须是字符串字面量，当前为 ${argument}`,
      );
      return { bindings, failures };
    }
    controllerPath = literal[1]!;
  }

  const decoratorPattern =
    /@([A-Za-z]+)\(([^)]*)\)\s*(?:@[A-Za-z]+\([^)]*\)\s*)*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const match of source.matchAll(decoratorPattern)) {
    const decorators = [
      ...match[0].matchAll(/@([A-Za-z_][A-Za-z0-9_]*)\(([^)]*)\)/g),
    ].map((decorator) => ({
      name: decorator[1]!,
      argument: decorator[2]!.trim(),
    }));
    const methodDecorator = decorators.find(
      (decorator) => methodDecorators[decorator.name] !== undefined,
    );
    if (methodDecorator === undefined) {
      continue;
    }
    const decorator = methodDecorator.name;
    const rawArgument = methodDecorator.argument;
    const handler = match[3]!;
    const method = methodDecorators[decorator];
    if (method === undefined) {
      continue;
    }
    const operationDecorator = decorators.find(
      (candidate) =>
        candidate.name === "Operation" ||
        candidate.name === "ContractOperation",
    );
    const operationId =
      operationDecorator?.argument.match(/^"([^"]*)"$/)?.[1] ??
      operationDecorator?.argument.match(/^'([^']*)'$/)?.[1];
    if (operationDecorator !== undefined && operationId === undefined) {
      failures.push(`${file}: ${handler} 的 @Operation 参数必须是字符串字面量`);
    }
    if (operationId === undefined) {
      failures.push(`${file}: ${handler} 缺少 @Operation 字符串字面量`);
    }
    let subPath = "";
    if (rawArgument.length > 0) {
      const literal =
        rawArgument.match(/^"([^"]*)"$/) ?? rawArgument.match(/^'([^']*)'$/);
      if (!literal) {
        failures.push(
          `${file}: @${decorator} 参数必须是字符串字面量，当前为 ${rawArgument}`,
        );
        continue;
      }
      subPath = literal[1]!;
    }
    const path = joinPath(controllerPath, subPath).replace(
      /:[A-Za-z_][A-Za-z0-9_]*/g,
      (parameter) => `{${parameter.slice(1)}}`,
    );
    bindings.push({
      method,
      path,
      handler,
      operationId: operationId ?? "",
      file,
    });
  }

  if (bindings.length === 0) {
    failures.push(`${file}: 未解析出任何路由方法装饰器`);
  }
  return { bindings, failures };
}

export function parseGlobalPrefix(source: string): string | undefined {
  const match =
    source.match(/setGlobalPrefix\(\s*"([^"]*)"\s*\)/) ??
    source.match(/setGlobalPrefix\(\s*'([^']*)'\s*\)/);
  if (!match) {
    return undefined;
  }
  return `/${match[1]!.replace(/^\/+|\/+$/g, "")}`;
}

async function collectControllerFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectControllerFiles(full)));
      continue;
    }
    if (entry.name.endsWith(".controller.ts")) {
      files.push(full);
    }
  }
  return files.sort();
}

export async function scanApiControllers(
  repositoryRoot: string,
): Promise<ApiScan> {
  const apiSource = resolve(repositoryRoot, "apps/api/src");
  const failures: string[] = [];
  const bindings: ControllerBinding[] = [];

  const mainSource = await readFile(resolve(apiSource, "main.ts"), "utf8");
  const prefix = parseGlobalPrefix(mainSource);
  if (!prefix) {
    failures.push("apps/api/src/main.ts: 未找到 setGlobalPrefix 字符串字面量");
  }

  for (const file of await collectControllerFiles(apiSource)) {
    const source = await readFile(file, "utf8");
    const parsed = parseControllerSource(
      source,
      relative(repositoryRoot, file).split("\\").join("/"),
    );
    failures.push(...parsed.failures);
    for (const binding of parsed.bindings) {
      bindings.push({ ...binding, path: joinPath(prefix ?? "", binding.path) });
    }
  }

  return { globalPrefix: prefix ?? "", bindings, failures };
}

export function validateControllerBindings(
  routes: readonly RouteDefinition[],
  scan: ApiScan,
): Finding[] {
  const findings: Finding[] = [];
  for (const failure of scan.failures) {
    findings.push({
      rule: "controller-binding",
      operationId: "-",
      message: failure,
    });
  }
  if (scan.globalPrefix && scan.globalPrefix !== apiBasePath) {
    findings.push({
      rule: "controller-binding",
      operationId: "-",
      message: `apps/api 全局前缀 ${scan.globalPrefix} 必须等于契约的 ${apiBasePath}`,
    });
  }

  for (const route of routes) {
    const expected = `${apiBasePath}${route.path}`;
    const match = scan.bindings.find(
      (binding) =>
        binding.method === route.method &&
        binding.path === expected &&
        binding.operationId === route.operationId,
    );
    if (!match) {
      const pathMatch = scan.bindings.find(
        (binding) =>
          binding.method === route.method && binding.path === expected,
      );
      findings.push({
        rule: "controller-binding",
        operationId: route.operationId,
        message:
          pathMatch === undefined
            ? `Route Registry 登记的 ${route.method} ${expected} 在 apps/api 中没有对应 Controller`
            : `Route Registry 的 ${route.operationId} 与 Controller ${pathMatch.operationId || pathMatch.handler} 不一致`,
      });
    }
  }

  for (const binding of scan.bindings) {
    const match = routes.find(
      (route) =>
        route.method === binding.method &&
        `${apiBasePath}${route.path}` === binding.path,
    );
    if (!match) {
      findings.push({
        rule: "controller-binding",
        operationId: "-",
        message: `${binding.file} 的 ${binding.method} ${binding.path} 未登记到 Route Registry`,
      });
    }
  }

  return findings;
}
