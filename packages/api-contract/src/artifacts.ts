import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  renderClientSource,
  renderIndexSource,
  renderTypesSource,
} from "./client.js";
import {
  mergeFingerprintHistory,
  type ContractFingerprints,
} from "./fingerprints.js";
import { buildSchemaComponents } from "./json-schema.js";
import { buildDefaultOpenApiDocument } from "./openapi.js";
import { routeRegistry } from "./route-registry.js";

const contractPackageRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const repositoryRoot = resolve(contractPackageRoot, "../..");

export const openApiArtifactPath =
  "packages/api-contract/generated/openapi.json";
export const fingerprintArtifactPath =
  "packages/api-contract/generated/route-contract-fingerprints.json";
export const clientArtifactDirectory = "apps/web/src/generated/api";

export interface Artifact {
  readonly path: string;
  readonly content: string;
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readCommittedFingerprints(): Promise<ContractFingerprints> {
  try {
    const raw = await readFile(
      resolve(repositoryRoot, fingerprintArtifactPath),
      "utf8",
    );
    return JSON.parse(raw) as ContractFingerprints;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {};
    }
    throw error;
  }
}

export function renderArtifacts(
  fingerprints: ContractFingerprints = {},
): readonly Artifact[] {
  const schemas = buildSchemaComponents();
  const document = buildDefaultOpenApiDocument();
  const merged = mergeFingerprintHistory(fingerprints, routeRegistry, schemas);
  return [
    { path: openApiArtifactPath, content: serializeJson(document) },
    { path: fingerprintArtifactPath, content: serializeJson(merged) },
    {
      path: `${clientArtifactDirectory}/types.ts`,
      content: renderTypesSource(schemas),
    },
    {
      path: `${clientArtifactDirectory}/client.ts`,
      content: renderClientSource(routeRegistry, schemas),
    },
    {
      path: `${clientArtifactDirectory}/index.ts`,
      content: renderIndexSource(),
    },
  ];
}

export async function writeArtifacts(
  artifacts: readonly Artifact[],
): Promise<void> {
  for (const artifact of artifacts) {
    const target = resolve(repositoryRoot, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.content, "utf8");
  }
}

export async function readArtifact(path: string): Promise<string | undefined> {
  try {
    return await readFile(resolve(repositoryRoot, path), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
}
