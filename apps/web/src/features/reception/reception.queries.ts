import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelEncounterRequest, CheckInRequest, RegisterReceptionRequest, ReleaseEncounterRequest, StartConsultationRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { cancelEncounter, checkIn, getReceptionList, registerReception, releaseEncounter, startConsultation } from './reception.api';

/**
 * "Danh sách tiếp nhận" (không `doctorId`) / "Hàng đợi khám" (kèm `doctorId`, `includeDepartmentPool`
 * — "Hàng đợi ảo" #064, gộp thêm hàng chờ chung Khoa của chính bác sĩ đó, `queueView` — Thu ngân cơ
 * bản, ẩn khỏi kết quả các lượt khám CHECKED_IN chưa thu tiền và không được phép nợ, xem
 * `receptionListQuerySchema` ở `@nexamed/shared`) — cùng nguồn dữ liệu, chỉ khác tham số lọc. 1
 * ngày/tenant nhỏ (không cursor) — cùng lý do `useAppointmentsByDateQuery` (chế độ Lưới).
 */
export function useReceptionListQuery(date?: string, doctorId?: string, includeDepartmentPool?: boolean, queueView?: boolean, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'reception', 'list', date, doctorId, includeDepartmentPool ? 'pool' : undefined, queueView ? 'queueView' : undefined),
    queryFn: () => getReceptionList(date, doctorId, includeDepartmentPool, queueView),
    // Danh sách cần cập nhật khá liên tục trong giờ làm việc (khách vừa tiếp nhận xong, bác sĩ vừa
    // bắt đầu khám) — tự làm mới định kỳ thay vì chỉ dựa vào invalidate thủ công sau mutation.
    refetchInterval: 30_000,
    // `enabled` (mặc định true, không đổi hành vi nơi gọi cũ) — nút "Hàng chờ" ở Topbar
    // (`DoctorQueueButton.tsx`) render ở MỌI trang nhưng chỉ nên poll khi đúng vai trò bác sĩ.
    enabled,
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
