import {
  RecordLinkQueryPort,
  RecordLinkCommandPort,
} from "./external-link-target.port.js";
import { RecordLifecycleController } from "./record-lifecycle.controller.js";
import { RecordLifecycleRepository } from "./record-lifecycle.repository.js";
import { RecordLifecycleHttpService } from "./record-lifecycle-http.service.js";
import { RecordLifecycleService } from "./record-lifecycle.service.js";
import {
  LeftoverRecordCommandPort,
  PostgresLeftoverRecordCommandPort,
} from "./leftover-record.port.js";
import { LeftoverRecordRepository } from "./leftover-record.repository.js";
import { RecordPublicationCommandPort } from "./record-publication.port.js";
import { RecordPublicationService } from "./record-publication.service.js";
import { RecordPublicationHttpService } from "./record-publication-http.service.js";
import { RecordPublicationAccess } from "./record-publication-access.js";
import { RecordPublicationRepository } from "./record-publication.repository.js";
import { RecordPublicationEffects } from "./record-publication-effects.js";
import { RecordDraftRepository } from "./record-draft.repository.js";
import { ModulesModule } from "../modules/index.js";
import { FeaturesModule } from "../features/index.js";
import { TasksManagementModule } from "../tasks/index.js";
import { AuditModule } from "../../audit/audit.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { ActivityProjectionModule } from "../activity/index.js";
import { NotificationProjectionModule } from "../notifications/index.js";
import { SearchProjectionModule } from "../search/index.js";
import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { ProjectsModule } from "../projects/index.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import { PublishedRecordReadService } from "./published-record-read.service.js";
import { PublishedRecordsHttpService } from "./published-records-http.service.js";
import { PublishedRecordsController } from "./published-records.controller.js";
@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    ProjectsModule,
    ModulesModule,
    FeaturesModule,
    TasksManagementModule,
    AuditModule,
    IdempotencyModule,
    ActivityProjectionModule,
    NotificationProjectionModule,
    SearchProjectionModule,
  ],
  exports: [
    RecordLinkQueryPort,
    RecordLinkCommandPort,
    RecordPublicationCommandPort,
    LeftoverRecordCommandPort,
  ],
  providers: [
    RecordLinkQueryPort,
    RecordLinkCommandPort,
    RecordLifecycleService,
    RecordLifecycleHttpService,
    RecordLifecycleRepository,
    RecordPublicationService,
    LeftoverRecordRepository,
    {
      provide: LeftoverRecordCommandPort,
      useClass: PostgresLeftoverRecordCommandPort,
    },
    RecordPublicationHttpService,
    RecordPublicationAccess,
    RecordPublicationRepository,
    RecordPublicationEffects,
    RecordDraftRepository,
    {
      provide: RecordPublicationCommandPort,
      useExisting: RecordPublicationService,
    },
    PublishedRecordRepository,
    PublishedRecordReadService,
    PublishedRecordsHttpService,
  ],
  controllers: [PublishedRecordsController, RecordLifecycleController],
})
export class PublishedRecordsModule {}
