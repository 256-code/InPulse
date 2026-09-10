import { Injectable } from "@nestjs/common";
import type { ExternalLinkTargetType } from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import { normalizeGitHubUrl } from "./github-url.js";
import { githubLinkLabel } from "./github-link-label.js";
import { linkAssociation } from "./external-link-query.port.js";
@Injectable()
export class ExternalLinksRepository {
  async list(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
  ) {
    const a = linkAssociation[type];
    const rows = await tx.sql<
      {
        id: number;
        projectId: number;
        normalizedUrl: string;
        kind: "ISSUE" | "PULL_REQUEST" | "COMMIT" | "OTHER";
        repository: string | null;
        externalNumber: string | null;
        externalSha: string | null;
      }[]
    >`SELECT l.id,l.project_id AS "projectId",l.normalized_url AS "normalizedUrl",l.kind,l.repository,l.external_number::text AS "externalNumber",l.external_sha AS "externalSha" FROM app.external_links l JOIN ${tx.sql("app." + a.table)} a ON a.project_id=l.project_id AND a.link_id=l.id WHERE a.project_id=${p} AND ${tx.sql("a." + a.column)}=${id} ORDER BY l.id`;
    return rows.map((row) => ({
      ...row,
      ...githubLinkLabel(row.normalizedUrl),
    }));
  }
  async add(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
    actor: number,
    url: string,
  ) {
    const value = normalizeGitHubUrl(url);
    // Persist only the safe canonical URL; discard unapproved query/fragment even in display_url.
    await tx.sql`INSERT INTO app.external_links(project_id,display_url,normalized_url,kind,repository,external_number,external_sha,created_by) VALUES(${p},${value.normalizedUrl},${value.normalizedUrl},${value.kind},${value.repository},${value.externalNumber},${value.externalSha},${actor}) ON CONFLICT(project_id,normalized_url) DO NOTHING`;
    const [link] = await tx.sql<
      { id: number }[]
    >`SELECT id FROM app.external_links WHERE project_id=${p} AND normalized_url=${value.normalizedUrl}`;
    const a = linkAssociation[type];
    const rows =
      type === "PROJECT"
        ? await tx.sql`INSERT INTO app.project_external_links(project_id,link_id) VALUES(${p},${link!.id}) ON CONFLICT DO NOTHING RETURNING link_id`
        : await tx.sql`INSERT INTO ${tx.sql("app." + a.table)}(project_id,${tx.sql(a.column)},link_id) VALUES(${p},${id},${link!.id}) ON CONFLICT DO NOTHING RETURNING link_id`;
    return {
      linkId: link!.id,
      changed: rows.length > 0,
      url: value.normalizedUrl,
    };
  }
  async remove(
    tx: TransactionContext,
    p: number,
    type: ExternalLinkTargetType,
    id: number,
    linkId: number,
  ) {
    const a = linkAssociation[type];
    const before = (await this.list(tx, p, type, id)).find(
      (link) => link.id === linkId,
    );
    if (!before) return undefined;
    await tx.sql`DELETE FROM ${tx.sql("app." + a.table)} WHERE project_id=${p} AND ${tx.sql(a.column)}=${id} AND link_id=${linkId}`;
    return { linkId, url: before.normalizedUrl, changed: true };
  }
  async exists(tx: TransactionContext, p: number, linkId: number) {
    const rows =
      await tx.sql`SELECT id FROM app.external_links WHERE id=${linkId} AND project_id=${p}`;
    return rows.length > 0;
  }
}
