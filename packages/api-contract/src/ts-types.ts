import { resolveComponentRef, type JsonSchema } from "./json-schema.js";

const componentRefPrefix = "#/components/schemas/";
const identifierPattern = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export function componentNameFromRef(ref: string): string {
  if (!ref.startsWith(componentRefPrefix)) {
    throw new Error(
      `Unsupported JSON Schema reference in generated types: ${ref}`,
    );
  }
  const name = ref.slice(componentRefPrefix.length);
  if (!identifierPattern.test(name)) {
    throw new Error(
      `Component name is not a valid TypeScript identifier: ${name}`,
    );
  }
  return name;
}

function asSchema(value: unknown, label: string): JsonSchema {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Unsupported JSON Schema node for ${label}`);
  }
  return value as JsonSchema;
}

function printPrimitive(type: string): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      throw new Error(`Unsupported JSON Schema primitive type: ${type}`);
  }
}

function printLiteral(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return JSON.stringify(value);
  }
  throw new Error(`Unsupported JSON Schema literal: ${JSON.stringify(value)}`);
}

function safeKey(key: string): string {
  return identifierPattern.test(key) ? key : JSON.stringify(key);
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 生成客户端使用自包含类型，不引入 zod 运行时依赖，也不导入数据库 Schema
 * （技术设计 4.1 第 6 条）。遇到无法表达的 JSON Schema 节点必须失败，
 * 禁止退化成 any。
 */
export function printTypeNode(
  node: JsonSchema,
  components: Readonly<Record<string, JsonSchema>>,
  indent: number,
): string {
  const pad = "  ".repeat(indent);
  const childPad = "  ".repeat(indent + 1);

  if (typeof node.$ref === "string") {
    return componentNameFromRef(node.$ref);
  }

  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union) && union.length > 0) {
    const parts = union.map((branch) =>
      printTypeNode(asSchema(branch, "union branch"), components, indent),
    );
    return parts.length === 1 ? parts[0]! : `(${parts.join(" | ")})`;
  }

  const type = node.type;
  if (Array.isArray(type)) {
    return `(${type.map((entry) => printPrimitive(String(entry))).join(" | ")})`;
  }

  if (node.const !== undefined) {
    return printLiteral(node.const);
  }
  if (Array.isArray(node.enum)) {
    const parts = node.enum.map(printLiteral);
    return parts.length === 1 ? parts[0]! : `(${parts.join(" | ")})`;
  }

  if (type === "object" || node.properties !== undefined) {
    const properties = node.properties;
    if (isRecord(properties) && Object.keys(properties).length > 0) {
      const required = new Set(
        Array.isArray(node.required) ? node.required.map(String) : [],
      );
      const lines = Object.entries(properties).map(([key, child]) => {
        const printed = printTypeNode(
          asSchema(child, `property ${key}`),
          components,
          indent + 1,
        );
        const optional = required.has(key) ? "" : "?";
        return `${childPad}readonly ${safeKey(key)}${optional}: ${printed};`;
      });
      return `{\n${lines.join("\n")}\n${pad}}`;
    }
    const additional = node.additionalProperties;
    if (isRecord(additional) && Object.keys(additional).length > 0) {
      return `Readonly<Record<string, ${printTypeNode(additional, components, indent)}>>`;
    }
    return "Readonly<Record<string, unknown>>";
  }

  if (type === "array") {
    const printed = printTypeNode(
      asSchema(node.items, "array items"),
      components,
      indent,
    );
    return printed.includes("\n")
      ? `readonly (${printed})[]`
      : `readonly ${printed}[]`;
  }

  if (typeof type === "string") {
    return printPrimitive(type);
  }

  if (Object.keys(node).length === 0) {
    return "unknown";
  }

  throw new Error(
    `Unsupported JSON Schema node while generating types: ${JSON.stringify(node)}`,
  );
}

export function printNamedType(
  ref: string,
  components: Readonly<Record<string, JsonSchema>>,
): string {
  return printTypeNode(resolveComponentRef(ref, components), components, 0);
}
