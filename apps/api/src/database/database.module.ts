import { Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { resolveDatabaseUrl } from "@inpulse/database/config";
import { DATABASE_CLIENT } from "./database.constants.js";
import { PostgresUnitOfWork } from "./unit-of-work.js";

@Module({
  providers: [
    {
      provide: DATABASE_CLIENT,
      useFactory: async () =>
        createDatabaseClient(await resolveDatabaseUrl("RUNTIME"), {
          applicationName: "inpulse-api",
        }),
    },
    {
      provide: PostgresUnitOfWork,
      useFactory: (client: DatabaseClient) => new PostgresUnitOfWork(client),
      inject: [DATABASE_CLIENT],
    },
  ],
  exports: [DATABASE_CLIENT, PostgresUnitOfWork],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }
}
