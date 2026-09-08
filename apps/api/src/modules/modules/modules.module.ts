import { Module } from "@nestjs/common";
import { ModulesCommandPort } from "./modules.command-port.js";
import { ModulesCommandService } from "./modules-command.service.js";
import { ModulesRepository } from "./modules.repository.js";

@Module({
  providers: [
    ModulesRepository,
    {
      provide: ModulesCommandPort,
      inject: [ModulesRepository],
      useFactory: (repository: ModulesRepository) =>
        new ModulesCommandService(repository),
    },
  ],
  exports: [ModulesCommandPort],
})
export class ModulesModule {}
