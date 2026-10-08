import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AmendParaclinicalResultRequest, ListParaclinicalQueueQuery, SaveParaclinicalResultRequest, StartParaclinicalItemsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import type { ParaclinicalGroup } from './paraclinical-group';
import { amendParaclinicalResult, approveParaclinicalResult, cancelParaclinicalAmendment, deleteParaclinicalImage, getParaclinicalResult, listParaclinicalQueue, recordParaclinicalResultPrint, saveParaclinicalResult, startParaclinicalItems, uploadParaclinicalImage } from './paraclinical-result.api';

/** Cận lâm sàng GĐ4 — Hàng đợi & kết quả (docs/DECISIONS.md #212), tách 2 menu theo nhóm (#215). Cache key có `group` vì 2 nhóm là 2 hàng đợi độc lập. */

const QUEUE_REFRESH_MS = 30_000;

export function useParaclinicalQueueQuery(group: ParaclinicalGroup, params: ListParaclinicalQueueQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'paraclinical', 'queue', group, JSON.stringify(params)),
    queryFn: () => listParaclinicalQueue(group, params),
    // Hàng đợi là màn "treo" ở quầy kỹ thuật — tự làm mới để thấy phiếu mới thu tiền/chỉ định, không bắt bấm F5.
    refetchInterval: QUEUE_REFRESH_MS,
  });
}

export function useParaclinicalResultQuery(group: ParaclinicalGroup, itemId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'paraclinical', 'result', itemId),
    queryFn: () => getParaclinicalResult(group, itemId),
  });
}

function useInvalidateQueue() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'paraclinical', 'queue') });
}

export function useStartParaclinicalMutation(group: ParaclinicalGroup) {
  const invalidateQueue = useInvalidateQueue();
  return useMutation({ mutationFn: (body: StartParaclinicalItemsRequest) => startParaclinicalItems(group, body), onSuccess: invalidateQueue });
}

export function useSaveParaclinicalResultMutation(group: ParaclinicalGroup, itemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidateQueue = useInvalidateQueue();
  return useMutation({
    mutationFn: (body: SaveParaclinicalResultRequest) => saveParaclinicalResult(group, itemId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', itemId), data);
      invalidateQueue();
    },
  });
}

export function useApproveParaclinicalResultMutation(group: ParaclinicalGroup, itemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidateQueue = useInvalidateQueue();
  return useMutation({
    mutationFn: (body: SaveParaclinicalResultRequest) => approveParaclinicalResult(group, itemId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', itemId), data);
      invalidateQueue();
    },
  });
}

/** Đính chính / huỷ đính chính: form trả về thay luôn dữ liệu màn hình, làm mới hàng đợi và khối "Kết quả đã có" ở màn khám. */
export function useAmendParaclinicalMutations(group: ParaclinicalGroup, itemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidateQueue = useInvalidateQueue();
  const apply = (data: Awaited<ReturnType<typeof amendParaclinicalResult>>) => {
    queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', itemId), data);
    invalidateQueue();
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinical-order', 'detail') });
  };
  const amend = useMutation({ mutationFn: (body: AmendParaclinicalResultRequest) => amendParaclinicalResult(group, itemId, body), onSuccess: apply });
  const cancel = useMutation({ mutationFn: () => cancelParaclinicalAmendment(group, itemId), onSuccess: apply });
  return { amend, cancel };
}

export function usePrintParaclinicalResultMutation(group: ParaclinicalGroup, itemId: string) {
  return useMutation({ mutationFn: () => recordParaclinicalResultPrint(group, itemId) });
}

/** Thêm / gỡ ảnh đính kèm của màn nhập đang mở (`pageItemId`); form trả về thay luôn dữ liệu màn hình. */
export function useParaclinicalImageMutations(pageItemId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const apply = (data: Awaited<ReturnType<typeof uploadParaclinicalImage>>) => queryClient.setQueryData(queryKey(tenantId, 'paraclinical', 'result', pageItemId), data);
  const upload = useMutation({ mutationFn: ({ itemId, file }: { itemId: string; file: File }) => uploadParaclinicalImage(itemId, file), onSuccess: apply });
  const remove = useMutation({ mutationFn: (imageId: string) => deleteParaclinicalImage(imageId), onSuccess: apply });
  return { upload, remove };
}
