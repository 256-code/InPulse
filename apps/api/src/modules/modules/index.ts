export {
  ModulesCommandPort,
  UnclassifiedModuleConflictError,
  type CreateUnclassifiedModuleInput,
  type CreateUnclassifiedModuleResult,
} from "./modules.command-port.js";
export { ModulesModule } from "./modules.module.js";
export {
  ModuleQueryPort,
  type CheckModuleForWriteInput,
  type ModuleForWriteResource,
  type ModuleWriteCheckResult,
} from "./module-query.port.js";
