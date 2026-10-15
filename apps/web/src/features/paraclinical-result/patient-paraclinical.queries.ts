import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { PatientIndicatorTrendQuery } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import type { ParaclinicalGroup } from './paraclinical-group';
import { getPatientIndicatorTrend, listPatientIndicators, listPatientParaclinicalResults, type PatientParaclinicalResultsParams } from './patient-paraclinical.api';

/** Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234). Cache key có `patientId` và `group` (hai nhóm quyền riêng). */

const PAGE_SIZE = 50;

export function usePatientParaclinicalResultsQuery(group: ParaclinicalGroup, patientId: string, params: PatientParaclinicalResultsParams, enabled = true) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'patient-paraclinical', 'results', patientId, group, JSON.stringify(params)),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => listPatientParaclinicalResults(group, patientId, { ...params, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePatientIndicatorsQuery(patientId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'patient-paraclinical', 'indicators', patientId),
    queryFn: () => listPatientIndicators(patientId),
    enabled,
  });
}

export function usePatientIndicatorTrendQuery(patientId: string, query: PatientIndicatorTrendQuery | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'patient-paraclinical', 'trend', patientId, query?.code ?? '', query?.unit ?? ''),
    queryFn: () => getPatientIndicatorTrend(patientId, query!),
    enabled: query !== null,
  });
}
