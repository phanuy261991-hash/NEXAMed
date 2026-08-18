import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePatientRequest, UpdatePatientRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import {
  createPatient,
  findPatientsByNationalId,
  findPatientsByPhone,
  getPatient,
  listPatients,
  updatePatient,
  uploadPatientPhoto,
} from './patient.api';

const PATIENT_LIST_LIMIT = 50;

/**
 * Phân trang cursor (PAT-02, .claude/docs/architecture.md) — dùng `useInfiniteQuery`, không offset.
 * `placeholderData: keepPreviousData` — mỗi từ khoá tìm kiếm khác nhau là một query key mới
 * (chưa có cache), mặc định TanStack Query sẽ coi là "chưa có dữ liệu" và xoá sạch bảng hiện có
 * để hiện khung xương trong lúc chờ — gõ một từ với nhịp gõ bình thường (mỗi lần ngừng gõ >300ms
 * debounce) trải qua nhiều vòng "xoá trắng → khung xương → kết quả" liên tiếp, thấy như nháy liên
 * tục. Giữ kết quả CŨ hiển thị (kèm cờ `isPlaceholderData`) cho tới khi kết quả MỚI về hẳn thì mới
 * thay, không còn khoảng trắng giữa hai lần gõ.
 */
export function usePatientsQuery(q: string) {
  const { tenantId } = useAppConfig();
  return useInfiniteQuery({
    queryKey: queryKey(tenantId, 'patient', 'list', q || undefined),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listPatients({ q: q || undefined, cursor: pageParam, limit: PATIENT_LIST_LIMIT }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

const PATIENT_PICKER_LIMIT = 8;

/**
 * Tìm bệnh nhân cho `PatientPicker` (S2-09, form đặt lịch nhanh) — top N kết quả, không phân
 * trang/cuộn vô hạn như `usePatientsQuery` (màn hình danh sách). Tự tắt khi `q` rỗng (không gọi
 * API cho tới khi lễ tân gõ gì đó).
 */
export function usePatientSearchQuery(q: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'patient', 'search', q || undefined),
    queryFn: () => listPatients({ q, limit: PATIENT_PICKER_LIMIT }),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * Tra trùng SĐT (Sprint 3) — debounce 300ms (cùng khuôn `usePatientSearchQuery`), chỉ gọi khi đủ
 * độ dài hợp lệ (khớp `phone: z.string().min(8).max(15)` ở packages/shared). Dùng cho cảnh báo
 * mềm form Thêm/Sửa (`PatientFormFields`) VÀ chọn khách hàng ở trang Tiếp nhận.
 */
export function usePatientByPhoneQuery(phone: string, excludePatientId?: string) {
  const { tenantId } = useAppConfig();
  const debouncedPhone = useDebouncedValue(phone);
  const enabled = debouncedPhone.length >= 8 && debouncedPhone.length <= 15;
  return useQuery({
    queryKey: queryKey(tenantId, 'patient', 'by-phone', debouncedPhone, excludePatientId),
    queryFn: () => findPatientsByPhone(debouncedPhone, excludePatientId),
    enabled,
  });
}

/**
 * `enabled` mặc định `true` (giữ nguyên hành vi cũ ở `PatientDetailPage` — luôn có `id` thật). Màn
 * hình "Tiếp nhận bệnh nhân" (mockup đã duyệt) cần gọi có điều kiện — chỉ fetch chi tiết đầy đủ
 * SAU KHI đã chọn đúng 1 hồ sơ khớp trùng (qua SĐT/CCCD), tránh gọi với `id` rỗng.
 */
export function usePatientQuery(id: string, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'patient', 'detail', id),
    queryFn: () => getPatient(id),
    enabled: enabled && id !== '',
  });
}

/**
 * Tra trùng CCCD (Sprint 3 mở rộng, mockup đã duyệt) — cùng khuôn `usePatientByPhoneQuery`, debounce
 * 300ms, chỉ gọi khi đủ độ dài hợp lệ (khớp `nationalId: z.string().min(9).max(12)`).
 */
export function usePatientByNationalIdQuery(nationalId: string, excludePatientId?: string) {
  const { tenantId } = useAppConfig();
  const debounced = useDebouncedValue(nationalId);
  const enabled = debounced.length >= 9 && debounced.length <= 12;
  return useQuery({
    queryKey: queryKey(tenantId, 'patient', 'by-national-id', debounced, excludePatientId),
    queryFn: () => findPatientsByNationalId(debounced, excludePatientId),
    enabled,
  });
}

export function useCreatePatientMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePatientRequest) => createPatient(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient', 'list') });
    },
  });
}

export function useUpdatePatientMutation(id: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePatientRequest) => updatePatient(id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey(tenantId, 'patient', 'detail', id), updated);
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient', 'list') });
    },
  });
}

/** Ảnh đại diện (docs/DECISIONS.md #034) — cập nhật thẳng cache chi tiết, không cần invalidate
 * danh sách (list không hiển thị ảnh, xem ghi chú ở `patientSummarySchema`). */
export function useUploadPatientPhotoMutation(id: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, version }: { file: File; version: number }) => uploadPatientPhoto(id, file, version),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey(tenantId, 'patient', 'detail', id), updated);
    },
  });
}
