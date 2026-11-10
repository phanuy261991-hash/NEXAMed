import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApproveLabPartnerResultRequest, ListLabPartnerQueueQuery, ReceiveLabPartnerResultRequest, RejectLabPartnerItemRequest, ReturnLabPartnerResultRequest, SendLabPartnerSamplesRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { listLabPartnerAwaiting, approveLabPartnerResult, getLabPartnerCounts, listLabPartnerDone, listLabPartnerPending, listLabPartnerSent, receiveLabPartnerResult, rejectLabPartnerItem, returnLabPartnerResult, sendLabPartnerSamples } from './lab-partner.api';

/** Hàng đợi gửi mẫu là màn "treo" ở quầy kỹ thuật — tự làm mới 30 giây để thấy mẫu vừa lấy, như hàng đợi Xét nghiệm. */
const QUEUE_REFRESH_MS = 30_000;

export function useLabPartnerPendingQuery(params: ListLabPartnerQueueQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'lab-partner', 'pending', JSON.stringify(params)),
    queryFn: () => listLabPartnerPending(params),
    refetchInterval: QUEUE_REFRESH_MS,
  });
}

export function useLabPartnerSentQuery(params: ListLabPartnerQueueQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'lab-partner', 'sent', JSON.stringify(params)),
    queryFn: () => listLabPartnerSent(params),
    enabled,
    refetchInterval: QUEUE_REFRESH_MS,
  });
}

/** Sau khi gửi, mẫu rời "Chờ gửi" sang "Đã gửi" và rời hàng đợi Xét nghiệm → làm mới cả hai. */
export function useSendLabPartnerSamplesMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendLabPartnerSamplesRequest) => sendLabPartnerSamples(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'lab-partner') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'paraclinical', 'queue') });
    },
  });
}

/** Số đếm nhẹ cho chấm số ở menu: bác sĩ thấy ngay có kết quả đối tác chờ duyệt. Chỉ tải khi `enabled` (bật công tắc + có quyền xem). */
export function useLabPartnerCountsQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'lab-partner', 'counts'), queryFn: getLabPartnerCounts, enabled, refetchInterval: 60_000 });
}

/** Kết quả đối tác chờ bác sĩ duyệt (khối ở màn khám và Tổng quan bác sĩ); tự làm mới 30 giây, bị làm mới khi nhận/duyệt/trả lại (khoá bắt đầu bằng `lab-partner`). */
export function useLabPartnerAwaitingQuery(params: { encounterId?: string; mine?: boolean }, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'lab-partner', 'awaiting', JSON.stringify(params)), queryFn: () => listLabPartnerAwaiting(params), enabled, refetchInterval: QUEUE_REFRESH_MS });
}

export function useLabPartnerDoneQuery(params: ListLabPartnerQueueQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'lab-partner', 'done', JSON.stringify(params)),
    queryFn: () => listLabPartnerDone(params),
    enabled,
    refetchInterval: QUEUE_REFRESH_MS,
  });
}

/** Mọi thao tác nhận/không nhận/duyệt/trả lại đổi trạng thái dòng gửi và dòng chỉ định → làm mới hàng đợi gửi mẫu, hàng đợi xét nghiệm và công nợ nhà cung cấp. */
function useRefreshAfterResultChange() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'lab-partner') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'paraclinical') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier-debt') });
  };
}

export function useReceiveLabPartnerResultMutation() {
  const refresh = useRefreshAfterResultChange();
  return useMutation({ mutationFn: ({ file, data }: { file: File; data: ReceiveLabPartnerResultRequest }) => receiveLabPartnerResult(file, data), onSuccess: refresh });
}

export function useRejectLabPartnerItemMutation() {
  const refresh = useRefreshAfterResultChange();
  return useMutation({ mutationFn: ({ itemId, body }: { itemId: string; body: RejectLabPartnerItemRequest }) => rejectLabPartnerItem(itemId, body), onSuccess: refresh });
}

export function useApproveLabPartnerResultMutation() {
  const refresh = useRefreshAfterResultChange();
  return useMutation({ mutationFn: ({ itemId, body }: { itemId: string; body: ApproveLabPartnerResultRequest }) => approveLabPartnerResult(itemId, body), onSuccess: refresh });
}

export function useReturnLabPartnerResultMutation() {
  const refresh = useRefreshAfterResultChange();
  return useMutation({ mutationFn: ({ itemId, body }: { itemId: string; body: ReturnLabPartnerResultRequest }) => returnLabPartnerResult(itemId, body), onSuccess: refresh });
}
