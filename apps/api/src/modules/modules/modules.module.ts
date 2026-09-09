import { ModuleReadPort } from "./module-read.port.js";
import { PostgresModuleReadPort } from "./postgres-module-read-port.js";
import { Module } from "@nestjs/common";
import { ModulesCommandPort } from "./modules.command-port.js";
import { ModulesCommandService } from "./modules-command.service.js";
import { ModulesRepository } from "./modules.repository.js";
import { ModuleQueryPort } from "./module-query.port.js";
import { PostgresModuleQueryPort } from "./postgres-module-query-port.js";

@Module({
  providers: [
    { provide: ModuleReadPort, useClass: PostgresModuleReadPort },
    { provide: ModuleQueryPort, useClass: PostgresModuleQueryPort },
    ModulesRepository,
    {
      provide: ModulesCommandPort,
      inject: [ModulesRepository],
      useFactory: (repository: ModulesRepository) =>
        new ModulesCommandService(repository),
    },
  ],
  exports: [ModuleReadPort, ModulesCommandPort, ModuleQueryPort],
})
export class ModulesModule {}
