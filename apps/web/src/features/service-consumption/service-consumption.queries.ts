import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PutServiceNormRequest, RecordConsumptionRequest, ReverseConsumptionRequest, ServiceNormQuery } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getEncounterConsumption, getServiceNorm, putServiceNorm, recordConsumption, reverseConsumption } from './service-consumption.api';

/** Định mức của MỘT dịch vụ (chung cả công ty). `enabled=false` (thêm mới, chưa có id/mã, hoặc không có quyền) thì không gọi. */
export function useServiceNormQuery(query: ServiceNormQuery | null, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'service-consumption', 'norm', query?.kind, query?.ref),
    queryFn: () => getServiceNorm(query!),
    enabled: enabled && query !== null,
  });
}

export function usePutServiceNormMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ query, body }: { query: ServiceNormQuery; body: PutServiceNormRequest }) => putServiceNorm(query, body),
    onSuccess: () => {
      // Định mức đổi → mọi lượt khám đang mở phải lấy lại định mức mới để điền sẵn.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'service-consumption') });
    },
  });
}

/** Các lượt dịch vụ của một lượt khám + định mức + phiếu tiêu hao đã ghi. */
export function useEncounterConsumptionQuery(encounterId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'service-consumption', 'encounter', encounterId),
    queryFn: () => getEncounterConsumption(encounterId),
    enabled: enabled && encounterId !== '',
  });
}

/** Ghi / đảo phiếu: máy chủ trả lại danh sách dịch vụ mới nhất → ghi thẳng vào cache, đồng thời làm mới tồn kho (phiếu tiêu hao trừ/hoàn kho). */
function useConsumptionCacheUpdate(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return (fresh: unknown) => {
    queryClient.setQueryData(queryKey(tenantId, 'service-consumption', 'encounter', encounterId), fresh);
    for (const domain of ['stock-balance', 'stock-issue', 'stock-ledger', 'stock-expiry']) {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, domain) });
    }
  };
}

export function useRecordConsumptionMutation(encounterId: string) {
  const update = useConsumptionCacheUpdate(encounterId);
  return useMutation({ mutationFn: (body: RecordConsumptionRequest) => recordConsumption(body), onSuccess: update });
}

export function useReverseConsumptionMutation(encounterId: string) {
  const update = useConsumptionCacheUpdate(encounterId);
  return useMutation({ mutationFn: ({ issueId, body }: { issueId: string; body: ReverseConsumptionRequest }) => reverseConsumption(issueId, body), onSuccess: update });
}
