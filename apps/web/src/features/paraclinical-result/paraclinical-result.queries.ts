import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListParaclinicalQueueQuery, SaveParaclinicalResultRequest, StartParaclinicalItemsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { approveParaclinicalResult, getParaclinicalResult, listParaclinicalQueue, saveParaclinicalResult, startParaclinicalItems } from './paraclinical-result.api';

/** Cận lâm sàng GĐ4 đợt 1 — Hàng đợi & kết quả (docs/DECISIONS.md #212). */

const QUEUE_REFRESH_MS = 30_000;

export function useParaclinicalQueueQuery(params: ListParaclinicalQueueQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'paraclinical', 'queue', JSON.stringify(params)),
    queryFn: () => listParaclinicalQueue(params),
    // Hàng đợi là màn "treo" ở quầy kỹ thuật — tự làm mới để thấy phiếu mới thu tiền/chỉ định, không bắt bấm F5.
    refetchInterval: QUEUE_REFRESH_MS,
  });
}

export function useParaclinicalResultQuery(itemId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'paraclinical', 'result', itemId),
    queryFn: () => getParaclinicalResult(itemId),
  });
}

function useInvalidateQueue() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'paraclinical', 'queue') });
}

export function useStartParaclinicalMutation() {
  const invalidateQueue = useInvalidateQueue();
  return useMutation({ mutationFn: (body: StartParaclinicalItemsRequest) => startParaclinicalItems(body), onSuccess: invalidateQueue });
}

export function useSaveParaclinicalResultMutation(itemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidateQueue = useInvalidateQueue();
  return useMutation({
    mutationFn: (body: SaveParaclinicalResultRequest) => saveParaclinicalResult(itemId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', itemId), data);
      invalidateQueue();
    },
  });
}

export function useApproveParaclinicalResultMutation(itemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidateQueue = useInvalidateQueue();
  return useMutation({
    mutationFn: (body: SaveParaclinicalResultRequest) => approveParaclinicalResult(itemId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', itemId), data);
      invalidateQueue();
    },
  });
}
