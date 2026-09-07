import { readCommittedFingerprints, repositoryRoot } from "../src/artifacts.js";
import {
  scanApiControllers,
  validateControllerBindings,
} from "../src/controller-bindings.js";
import { buildSchemaComponents } from "../src/json-schema.js";
import { routeRegistry } from "../src/route-registry.js";
import { validateRouteRegistry, type Finding } from "../src/validate.js";
import { reportFindings } from "./report.js";

const fingerprints = await readCommittedFingerprints();
const findings: Finding[] = [
  ...validateRouteRegistry(
    routeRegistry,
    buildSchemaComponents(),
    fingerprints,
  ),
  ...validateControllerBindings(
    routeRegistry,
    await scanApiControllers(repositoryRoot),
  ),
];

process.exitCode = reportFindings(
  `Route Registry 完整性（${routeRegistry.length} 条路由）`,
  findings,
);
