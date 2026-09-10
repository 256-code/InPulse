import { Inject, Injectable } from "@nestjs/common";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "../projects/index.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import { PublishedRecordRepository } from "./published-record.repository.js";
import { RecordDraftError } from "./record-drafts.service.js";
const missing = () =>
  new RecordDraftError(
    404,
    "CHANGE_RECORD_NOT_FOUND",
    "记录或版本不存在或无法访问",
  );
@Injectable()
export class PublishedRecordReadService {
  constructor(
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(PublishedRecordRepository)
    private readonly repository: PublishedRecordRepository,
  ) {}
  async read(
    actorId: number,
    projectId: number,
    recordId?: number,
    versions = false,
    versionNo?: number,
  ) {
    const scope = await this.access.getAuthorizedSearchScope(actorId);
    if (!scope.projectIds.includes(projectId)) throw missing();
    return this.uow.run(async (tx) => {
      if (recordId === undefined)
        return { items: await this.repository.list(tx, projectId) };
      const record = await this.repository.find(tx, projectId, recordId);
      if (!record) throw missing();
      if (!versions) return record;
      const items = await this.repository.versions(tx, record, versionNo);
      if (versionNo !== undefined) {
        if (!items[0]) throw missing();
        return items[0];
      }
      return { items };
    });
  }
}
