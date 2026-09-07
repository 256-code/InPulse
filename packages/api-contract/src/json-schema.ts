import { z } from "zod";

import { schemaNames, schemaRegistry } from "./schema-registry.js";

export type JsonSchema = Record<string, unknown>;

const defsRefPrefix = "#/$defs/";
const componentRefPrefix = "#/components/schemas/";

export interface SchemaComponents {
  readonly components: Readonly<Record<string, JsonSchema>>;
  readonly rootRefs: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteRefs(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(rewriteRefs);
  }
  if (!isRecord(node)) {
    return node;
  }
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(node)) {
    if (
      key === "$ref" &&
      typeof value === "string" &&
      value.startsWith(defsRefPrefix)
    ) {
      result[key] = `${componentRefPrefix}${value.slice(defsRefPrefix.length)}`;
      continue;
    }
    result[key] = rewriteRefs(value);
  }
  return result;
}

function sortedRecord(
  record: Record<string, JsonSchema>,
): Record<string, JsonSchema> {
  const result: Record<string, JsonSchema> = {};
  for (const key of Object.keys(record).sort()) {
    result[key] = record[key]!;
  }
  return result;
}

/**
 * 技术设计 4.1：Schema Registry 通过 Zod 4 的 z.toJSONSchema 直接产出
 * OpenAPI 3.1 兼容的 JSON Schema 2020-12，不引入第三方 OpenAPI 生成器。
 * 每个条目必须带与注册名一致的 .meta({ id })，否则拒绝生成。
 */
export function buildSchemaComponents(): SchemaComponents {
  const components: Record<string, JsonSchema> = {};
  const rootRefs: Record<string, string> = {};

  for (const name of schemaNames) {
    const entry = schemaRegistry[name];
    const converted = z.toJSONSchema(entry.schema, {
      io: "output",
      target: "draft-2020-12",
    }) as JsonSchema;
    delete converted.$schema;

    const defs = converted.$defs;
    delete converted.$defs;
    if (isRecord(defs)) {
      for (const [defName, defSchema] of Object.entries(defs)) {
        if (!isRecord(defSchema)) {
          throw new Error(`Schema ${name}: $defs.${defName} is not an object`);
        }
        components[defName] = rewriteRefs(defSchema) as JsonSchema;
      }
    }

    const ref = converted.$ref;
    if (typeof ref === "string" && ref.startsWith(defsRefPrefix)) {
      const defName = ref.slice(defsRefPrefix.length);
      if (defName !== name) {
        throw new Error(
          `Schema ${name}: .meta({ id }) must equal the registry key, found "${defName}"`,
        );
      }
      if (!Object.hasOwn(components, defName)) {
        throw new Error(`Schema ${name}: missing $defs entry ${defName}`);
      }
      rootRefs[name] = `${componentRefPrefix}${defName}`;
      continue;
    }

    components[name] = rewriteRefs(converted) as JsonSchema;
    rootRefs[name] = `${componentRefPrefix}${name}`;
  }

  return { components: sortedRecord(components), rootRefs };
}

/** rootRefs 的安全访问器：引用不存在的 Schema 必须立即失败。 */
export function schemaRef(schemas: SchemaComponents, name: string): string {
  const ref = schemas.rootRefs[name];
  if (ref === undefined) {
    throw new Error(`Schema Registry 中不存在 "${name}"`);
  }
  return ref;
}

export function resolveComponentRef(
  ref: string,
  components: Readonly<Record<string, JsonSchema>>,
): JsonSchema {
  if (!ref.startsWith(componentRefPrefix)) {
    throw new Error(`Unsupported JSON Schema reference: ${ref}`);
  }
  const name = ref.slice(componentRefPrefix.length);
  const target = components[name];
  if (!target) {
    throw new Error(`Reference ${ref} does not exist in components.schemas`);
  }
  return target;
}

/**
 * ADR-019：safeBodyFieldPaths 必须穷尽且不越出 Schema 叶子字段。
 * 记法：对象嵌套用 `.`，数组元素用 `[]`，record 值用 `.*`。
 */
export function collectLeafPaths(
  rootRef: string,
  components: Readonly<Record<string, JsonSchema>>,
): readonly string[] {
  const leaves: string[] = [];
  const visiting = new Set<string>();

  const walk = (node: JsonSchema, prefix: string): void => {
    const ref = node.$ref;
    if (typeof ref === "string") {
      if (visiting.has(ref)) {
        leaves.push(prefix);
        return;
      }
      visiting.add(ref);
      walk(resolveComponentRef(ref, components), prefix);
      visiting.delete(ref);
      return;
    }

    const branches = node.anyOf ?? node.oneOf;
    if (Array.isArray(branches) && branches.length > 0) {
      for (const branch of branches) {
        if (!isRecord(branch)) {
          throw new Error(`Unsupported union branch at "${prefix}"`);
        }
        walk(branch, prefix);
      }
      return;
    }

    const properties = node.properties;
    if (isRecord(properties) && Object.keys(properties).length > 0) {
      for (const [key, child] of Object.entries(properties)) {
        if (!isRecord(child)) {
          throw new Error(`Unsupported property "${prefix}.${key}"`);
        }
        walk(child, prefix ? `${prefix}.${key}` : key);
      }
      return;
    }

    const items = node.items;
    if (isRecord(items)) {
      walk(items, `${prefix}[]`);
      return;
    }

    const additional = node.additionalProperties;
    if (isRecord(additional) && Object.keys(additional).length > 0) {
      walk(additional, `${prefix}.*`);
      return;
    }

    leaves.push(prefix);
  };

  walk(resolveComponentRef(rootRef, components), "");
  return [...new Set(leaves)].sort();
}
