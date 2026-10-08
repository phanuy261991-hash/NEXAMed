import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaveClinicalOrderRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getClinicalOrder, recordClinicalOrderPrint, saveClinicalOrder } from './clinical-order.api';

/** Cận lâm sàng GĐ3 — Chỉ định của bác sĩ (docs/DECISIONS.md #212). */

const RESULTS_REFRESH_MS = 30_000;

export function useClinicalOrderQuery(encounterId: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinical-order', 'detail', encounterId),
    queryFn: () => getClinicalOrder(encounterId),
    enabled,
    // Khối "Kết quả đã có của lượt khám này" phải thấy kết quả vừa được duyệt mà bác sĩ không cần F5 (bản nháp đang soạn không bị ghi đè — xem `serverKey` ở panel).
    refetchInterval: RESULTS_REFRESH_MS,
  });
}

export function useSaveClinicalOrderMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveClinicalOrderRequest) => saveClinicalOrder(encounterId, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinical-order', 'detail', encounterId), data);
      // Tiền chỉ định đã cộng/trừ vào hoá đơn — danh sách Thu ngân/chi tiết phiếu thu phải mới.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice') });
    },
  });
}

export function usePrintClinicalOrderMutation(encounterId: string) {
  return useMutation({ mutationFn: () => recordClinicalOrderPrint(encounterId) });
}
