import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CancelAppointmentRequest, CreateAppointmentRequest, EditAppointmentRequest, RescheduleAppointmentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import {
  cancelAppointment,
  createAppointment,
  editAppointment,
  getScheduleConfig,
  listAppointments,
  listDoctors,
  lookupAppointmentByPhone,
  rescheduleAppointment,
} from './appointment.api';

/** Chế độ lưới (S2-09) — một ngày/tenant chỉ vài chục lịch hẹn, không cần phân trang thật.
 * Trần 100 khớp đúng `listAppointmentsQuerySchema.limit.max(100)` (dùng chung mọi chế độ). */
const DAY_VIEW_LIMIT = 100;
const APPOINTMENT_LIST_LIMIT = 50;

export function useAppointmentsByDateQuery(date: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'appointment', 'day', date),
    queryFn: () => listAppointments({ date, limit: DAY_VIEW_LIMIT }),
  });
}

/**
 * Chế độ danh sách (S2-09) — cursor + cuộn vô hạn, cùng mẫu `usePatientsQuery` (S2-02/S2-08).
 * Lọc theo `date` giống chế độ Lưới (cùng thanh điều hướng ngày phía trên, dùng chung cho cả hai
 * chế độ) — trước đây thiếu tham số này nên đổi ngày không ảnh hưởng gì tới danh sách, đã sửa.
 */
export function useAppointmentsListQuery(date: string) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'appointment', 'list', date),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listAppointments({ date, cursor: pageParam, limit: APPOINTMENT_LIST_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useDoctorsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'appointment', 'doctors'),
    queryFn: () => listDoctors(),
  });
}

export function useScheduleConfigQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'appointment', 'schedule-config'),
    queryFn: () => getScheduleConfig(),
  });
}

/**
 * Tra cứu theo SĐT lúc đặt lịch (docs/DECISIONS.md #032) — debounce 300ms qua `useDebouncedValue`
 * đã có (`shared/hooks`, dùng chung với PAT-02), chỉ gọi khi đủ độ dài hợp lệ (khớp
 * `phone: z.string().min(8).max(15)` ở packages/shared) để không gọi API với input dở dang.
 */
export function useAppointmentPhoneLookupQuery(phone: string) {
  const { tenantId } = useAppConfig();
  const debouncedPhone = useDebouncedValue(phone);
  const enabled = debouncedPhone.length >= 8 && debouncedPhone.length <= 15;
  return useQuery({
    queryKey: queryKey(tenantId, 'appointment', 'phone-lookup', debouncedPhone),
    queryFn: () => lookupAppointmentByPhone(debouncedPhone),
    enabled,
  });
}

/** Vô hiệu hoá mọi query lịch hẹn (ngày lẫn danh sách) sau ghi — đơn giản, đúng quy mô một ngày/tenant nhỏ. */
function useInvalidateAppointments() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment') });
}

export function useCreateAppointmentMutation() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: (body: CreateAppointmentRequest) => createAppointment(body),
    onSuccess: () => void invalidate(),
  });
}

export function useCancelAppointmentMutation() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CancelAppointmentRequest }) => cancelAppointment(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useRescheduleAppointmentMutation() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RescheduleAppointmentRequest }) => rescheduleAppointment(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** "Sửa lịch" trong ngày (khôi phục 2026-08-18) — tồn tại song song với `useRescheduleAppointmentMutation` ("Dời lịch"). */
export function useEditAppointmentMutation() {
  const invalidate = useInvalidateAppointments();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EditAppointmentRequest }) => editAppointment(id, body),
    onSuccess: () => void invalidate(),
  });
}
