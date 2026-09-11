import React from "react";
import type { InpulseApiClient } from "@generated/api";
import { AuditLogPageView } from "@features/audit/AuditLogPageView";

export interface AuditPageProps {
  readonly client?: InpulseApiClient | undefined;
}

export const AuditPage: React.FC<AuditPageProps> = ({ client }) => {
  return <AuditLogPageView {...(client ? { client } : {})} />;
};

export default AuditPage;
