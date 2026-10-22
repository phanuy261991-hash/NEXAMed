import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelEncounterRequest,
  CheckInRequest,
  ReassignEncounterRequest,
  ReceptionListTabValue,
  RegisterReceptionRequest,
  ReleaseEncounterRequest,
  StartConsultationRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { cancelEncounter, checkIn, exportReceptionList, getDoctorUnseenResults, getReceptionList, reassignEncounter, registerReception, releaseEncounter, startConsultation } from './reception.api';

/**
 * "Danh sách tiếp nhận" (không `doctorId`) / "Hàng đợi khám" (kèm `doctorId`, `includeDepartmentPool`
 * — "Hàng đợi ảo" #064, gộp thêm hàng chờ chung Khoa của chính bác sĩ đó, `queueView` — Thu ngân cơ
 * bản, ẩn khỏi kết quả các lượt khám CHECKED_IN chưa thu tiền và không được phép nợ, xem
 * `receptionListQuerySchema` ở `@nexamed/shared`) — cùng nguồn dữ liệu, chỉ khác tham số lọc. 1
 * ngày/tenant nhỏ (không cursor) — cùng lý do `useAppointmentsByDateQuery` (chế độ Lưới).
 */
export function useReceptionListQuery(date?: string, doctorId?: string, includeDepartmentPool?: boolean, queueView?: boolean, enabled = true, tab?: ReceptionListTabValue) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'reception', 'list', date, doctorId, includeDepartmentPool ? 'pool' : undefined, queueView ? 'queueView' : undefined, tab),
    queryFn: () => getReceptionList(date, doctorId, includeDepartmentPool, queueView, tab ? { tab } : undefined),
    // Danh sách cần cập nhật khá liên tục trong giờ làm việc (khách vừa tiếp nhận xong, bác sĩ vừa
    // bắt đầu khám) — tự làm mới định kỳ thay vì chỉ dựa vào invalidate thủ công sau mutation.
    refetchInterval: 30_000,
    // `enabled` (mặc định true, không đổi hành vi nơi gọi cũ) — nút "Hàng chờ" ở Topbar
    // (`DoctorQueueButton.tsx`) render ở MỌI trang nhưng chỉ nên poll khi đúng vai trò bác sĩ.
    enabled,
  });
}

/** Số dòng mỗi lô của "Bệnh nhân trong ngày" (mockup đã duyệt, docs/DECISIONS.md #251) — cố định, không có ô chọn cỡ trang vì danh sách cuộn tải tiếp. */
export const RECEPTION_LIST_PAGE_SIZE = 50;

/**
 * "Bệnh nhân trong ngày" tải THEO LÔ khi cuộn (docs/DECISIONS.md #251): tab + từ khoá lọc ở máy chủ trên CẢ NGÀY, con trỏ khoá nên dòng mới tiếp nhận giữa chừng không làm trùng/sót.
 * Khoá bắt đầu bằng `'reception','list'` nên các mutation vẫn làm mới được qua `invalidateQueries` theo tiền tố. `keepPreviousData`: đổi tab/từ khoá/ngày giữ bảng cũ cho tới khi có
 * dữ liệu mới (không nháy trắng, ô tìm kiếm không mất tiêu điểm).
 */
export function useReceptionListInfiniteQuery(params: { date?: string; tab: ReceptionListTabValue; q: string }) {
  const { tenantId } = useAppConfig();
  const { date, tab, q } = params;
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'reception', 'list', 'paged', date, tab, q),
    queryFn: ({ pageParam }) => getReceptionList(date, undefined, undefined, undefined, { tab, q, limit: RECEPTION_LIST_PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    // Làm mới định kỳ chạy lại TẤT CẢ lô đã tải: đã cuộn sâu (> 8 lô) thì giãn ra 2 phút để không gọi hàng chục yêu cầu mỗi 30 giây.
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 8 ? 120_000 : 30_000),
  });
}

/** Chấm số kết quả cận lâm sàng mới ở menu "Hàng đợi khám" (#221) — chỉ poll khi đúng vai trò bác sĩ (`enabled`), cùng chu kỳ 30 giây với danh sách. */
export function useDoctorUnseenResultsQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'reception', 'doctor-unseen-results'),
    queryFn: getDoctorUnseenResults,
    refetchInterval: 30_000,
    enabled,
  });
}

export function useExportReceptionListMutation() {
  return useMutation({
    mutationFn: (date: string) => exportReceptionList(date),
  });
}

function useInvalidateReception() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
}

export function useCheckInMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: (body: CheckInRequest) => checkIn(body),
    // Check-in luôn đụng 1 appointment (appointment.status→CONVERTED) — invalidate cả 'appointment'
    // để badge trên panel/lưới Lịch hẹn cập nhật tại chỗ, không chỉ 'reception'.
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment') });
    },
  });
}

export function useRegisterReceptionMutation() {
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: (body: RegisterReceptionRequest) => registerReception(body),
    onSuccess: () => void invalidate(),
  });
}

export function useStartConsultationMutation() {
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: StartConsultationRequest }) => startConsultation(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelEncounterMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CancelEncounterRequest }) => cancelEncounter(id, body),
    // #085 — huỷ lượt khám có thể đóng phiếu thu (UNPAID→CANCELLED) trong cùng transaction ở
    // backend — làm mới luôn 'invoice' để `/billing` phản ánh đúng ngay, không cần F5 thủ công.
    onSuccess: () => {
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'invoice') });
    },
  });
}

/** #085 "Trả về hàng chờ" — bác sĩ nhả ca, KHÔNG đụng phiếu thu (chỉ invalidate 'reception'). */
export function useReleaseEncounterMutation() {
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReleaseEncounterRequest }) => releaseEncounter(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** "Trung tâm Điều phối Tiếp nhận" — lễ tân đổi bác sĩ/Khoa phụ trách, KHÔNG đụng phiếu thu. */
export function useReassignEncounterMutation() {
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReassignEncounterRequest }) => reassignEncounter(id, body),
    onSuccess: () => void invalidate(),
  });
}
