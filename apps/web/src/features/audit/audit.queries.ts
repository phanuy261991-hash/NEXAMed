import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { listAuditLog } from './audit.api';

const AUDIT_LOG_LIMIT = 30;

export interface AuditLogFilters {
  patientId?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/** Phân trang cursor (S5-05, ADM-03), cùng khuôn `usePatientsQuery`. */
export function useAuditLogQuery(filters: AuditLogFilters) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'audit-log', filters.patientId, filters.actorId, filters.from, filters.to),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listAuditLog({ ...filters, cursor: pageParam, limit: AUDIT_LOG_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}
