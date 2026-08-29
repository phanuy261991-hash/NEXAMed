import type { ListAuditLogResponse } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listAuditLog(params: {
  patientId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}): Promise<ListAuditLogResponse> {
  return unwrap(await getApiClient().GET('/api/v1/audit-log', { params: { query: params } })) as ListAuditLogResponse;
}
