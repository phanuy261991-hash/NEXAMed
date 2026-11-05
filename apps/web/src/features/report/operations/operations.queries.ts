import { keepPreviousData, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import {
  exportOperationsExcel,
  exportVisitBookExcel,
  getBookingSources,
  getCancellations,
  getFollowUps,
  getPeakHours,
  getVisitBook,
  getWaiting,
  type OperationsExportKind,
  type OperationsPeriodParams,
  type VisitBookParams,
} from './operations.api';

/** Số dòng mỗi lô của Sổ khám bệnh khi cuộn tải thêm. */
export const VISIT_BOOK_PAGE_SIZE = 50;

function periodKey(p: OperationsPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds]);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function usePeakHoursQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'operations', 'peak-hours', periodKey(p)), queryFn: () => getPeakHours(p), ...reportOptions(enabled) });
}

export function useWaitingQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'operations', 'waiting', periodKey(p)), queryFn: () => getWaiting(p), ...reportOptions(enabled) });
}

export function useCancellationsQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'operations', 'cancellations', periodKey(p)), queryFn: () => getCancellations(p), ...reportOptions(enabled) });
}

export function useFollowUpsReportQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'operations', 'follow-ups', periodKey(p)), queryFn: () => getFollowUps(p), ...reportOptions(enabled) });
}

export function useBookingSourcesQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'operations', 'booking-sources', periodKey(p)), queryFn: () => getBookingSources(p), ...reportOptions(enabled) });
}

/** Sổ khám bệnh — cuộn vô hạn theo khoá; giữ dữ liệu cũ khi đổi bộ lọc để bảng không nhấp nháy. */
export function useVisitBookQuery(p: VisitBookParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'report', 'operations', 'visit-book', periodKey(p), p.doctorId, p.icd10Code.trim(), p.q.trim()),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => getVisitBook({ ...p, cursor: pageParam, limit: VISIT_BOOK_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    ...reportOptions(enabled),
  });
}

export function useExportOperationsMutation(kind: OperationsExportKind) {
  return useMutation({ mutationFn: (p: OperationsPeriodParams) => exportOperationsExcel(kind, p) });
}

export function useExportVisitBookMutation() {
  return useMutation({ mutationFn: (p: VisitBookParams) => exportVisitBookExcel(p) });
}
