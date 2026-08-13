import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelEncounterRequest, CheckInRequest, RegisterReceptionRequest, StartConsultationRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { cancelEncounter, checkIn, getReceptionList, registerReception, startConsultation } from './reception.api';

/**
 * "Danh sách tiếp nhận" (không `doctorId`) / "Hàng đợi khám" (kèm `doctorId`) — cùng nguồn dữ
 * liệu, chỉ khác tham số lọc. 1 ngày/tenant nhỏ (không cursor) — cùng lý do
 * `useAppointmentsByDateQuery` (chế độ Lưới).
 */
export function useReceptionListQuery(date?: string, doctorId?: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'reception', 'list', date, doctorId),
    queryFn: () => getReceptionList(date, doctorId),
    // Danh sách cần cập nhật khá liên tục trong giờ làm việc (khách vừa tiếp nhận xong, bác sĩ vừa
    // bắt đầu khám) — tự làm mới định kỳ thay vì chỉ dựa vào invalidate thủ công sau mutation.
    refetchInterval: 30_000,
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
  const invalidate = useInvalidateReception();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CancelEncounterRequest }) => cancelEncounter(id, body),
    onSuccess: () => void invalidate(),
  });
}
