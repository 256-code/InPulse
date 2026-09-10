import { Module } from "@nestjs/common";
import { ExternalLinksRepository } from "./external-links.repository.js";
import {
  ExternalLinksQueryPort,
  ExternalLinksCommandPort,
} from "./external-links.port.js";
@Module({
  providers: [
    ExternalLinksRepository,
    ExternalLinksQueryPort,
    ExternalLinksCommandPort,
  ],
  exports: [ExternalLinksQueryPort, ExternalLinksCommandPort],
})
export class ExternalLinksModule {}
