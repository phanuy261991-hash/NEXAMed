import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListClinicalOrdersQuery, SaveClinicalOrderRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getClinicalOrder, listClinicalOrders, markClinicalOrderResultsSeen, recordClinicalOrderPrint, saveClinicalOrder } from './clinical-order.api';

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

const ORDER_BOOK_PAGE_SIZE = 50;

/** Menu "Phiếu chỉ định" (#232) — phân trang cursor, `keepPreviousData` để đổi nhóm/bộ lọc không nháy về khung xương. */
export function useClinicalOrderBookQuery(params: Omit<ListClinicalOrdersQuery, 'cursor' | 'limit'>) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'clinical-order', 'book', JSON.stringify(params)),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => listClinicalOrders({ ...params, cursor: pageParam, limit: ORDER_BOOK_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
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

/** Mở tab "Kết quả cận lâm sàng" (#221) — làm mới Hàng đợi khám + chấm số menu để nhãn "Có kết quả mới" tắt ngay, không đợi chu kỳ 30 giây. */
export function useMarkResultsSeenMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markClinicalOrderResultsSeen(encounterId),
    onSuccess: (data) => {
      if (data.marked > 0) void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
    },
  });
}
