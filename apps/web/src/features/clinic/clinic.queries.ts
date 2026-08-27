import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ClinicProfile,
  CreateExamStationRequest,
  CreateFloorRequest,
  CreateRoomRequest,
  RoomSession,
  SetRoomSessionRequest,
  UpdateClinicProfileRequest,
  UpdateClinicSettingsRequest,
  UpdateExamStationRequest,
  UpdateFloorRequest,
  UpdateRoomRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { useAuthStore } from '../auth/auth.store';
import { queryKey } from '../../shared/api/query-keys';
import {
  createExamStation,
  createFloor,
  createRoom,
  getClinicPrintHeader,
  getClinicProfile,
  getClinicSettings,
  getDeferredPaymentStatus,
  getMyRoomSession,
  getRoomOptions,
  listExamStations,
  listFloors,
  listRooms,
  setMyRoomSession,
  updateClinicProfile,
  updateClinicSettings,
  updateExamStation,
  updateFloor,
  updateRoom,
  uploadClinicLogo,
  uploadClinicPrintLogo,
} from './clinic.api';

export function useClinicSettingsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'settings'),
    queryFn: getClinicSettings,
  });
}

/**
 * Thu ngân cơ bản (Sprint 5/6) — `ReceptionIntakeForm.tsx` dùng riêng hook này (KHÔNG dùng
 * `useClinicSettingsQuery()`): lễ tân không có `clinic_config.read` (chỉ `clinic_admin`), phát
 * hiện thật lúc kiểm bằng trình duyệt (403) — cùng lớp lỗ hổng đã gặp ở #030.
 */
export function useDeferredPaymentEnabledQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'deferred-payment-enabled'),
    queryFn: getDeferredPaymentStatus,
  });
}

export function useUpdateClinicSettingsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClinicSettingsRequest) => updateClinicSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'settings') });
      // Lưới lịch hẹn đọc cùng dữ liệu qua GET /appointments/schedule-config (S2-09) — làm mới
      // luôn để đổi giờ làm việc/slot ở đây phản ánh ngay, không cần F5 thủ công.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment', 'schedule-config') });
      // Thu ngân cơ bản — ReceptionIntakeForm.tsx đọc qua hook tự-phục vụ riêng (useDeferredPaymentEnabledQuery), làm mới luôn.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'deferred-payment-enabled') });
    },
  });
}

/** Trang "Thông tin phòng khám" (2026-08-13). */
export function useClinicProfileQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'profile'),
    queryFn: getClinicProfile,
  });
}

/**
 * Tự-phục vụ (Thu ngân/Kê đơn) — `InvoiceDetailPage.tsx`/`PrescriptionPanel.tsx` dùng riêng hook
 * này (KHÔNG dùng `useClinicProfileQuery()`): lễ tân/bác sĩ không có `clinic_config.read` (chỉ
 * `clinic_admin`), phát hiện thật lúc kiểm bằng trình duyệt (403) cho màn Thu ngân — cùng lỗ hổng
 * đã có sẵn ở `PrescriptionPanel.tsx` (chưa từng lộ ra vì luôn kiểm bằng tài khoản admin), vá luôn.
 */
export function useClinicPrintHeaderQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'print-header'),
    queryFn: getClinicPrintHeader,
  });
}

export function useUpdateClinicProfileMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClinicProfileRequest) => updateClinicProfile(body),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}

/** 2 mutation logo set thẳng cache, không cần refetch — cùng mẫu `useUploadPatientPhotoMutation`. */
export function useUploadClinicLogoMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, version }: { file: File; version: number }) => uploadClinicLogo(file, version),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}

export function useUploadClinicPrintLogoMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, version }: { file: File; version: number }) => uploadClinicPrintLogo(file, version),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}

/** Pane "Phòng khám" (Quản trị, docs/DECISIONS.md #054) — không phân trang, cùng lý do `useReferenceCatalogQuery`. */
export function useRoomsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'clinic', 'rooms'), queryFn: listRooms });
}

export function useCreateRoomMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRoomRequest) => createRoom(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'rooms') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'room-options') });
    },
  });
}

export function useUpdateRoomMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoomRequest }) => updateRoom(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'rooms') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'room-options') });
    },
  });
}

const DOCTOR_ROLE = 'doctor';

/**
 * "Phòng làm việc hôm nay" (docs/DECISIONS.md #054) — chỉ bật cho vai trò `doctor`; tenant 0-1
 * phòng active thì `items` rỗng/1 phần tử, `RoomSessionGate.tsx` tự không hiện gì thêm (quyết
 * định "tự động ẩn hoàn toàn ở quy mô nhỏ" đã chốt qua AskUserQuestion).
 */
export function useRoomOptionsQuery() {
  const { tenantId } = useAppConfig();
  const user = useAuthStore((s) => s.user);
  const isDoctor = user?.roles.includes(DOCTOR_ROLE) ?? false;
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'room-options'),
    queryFn: getRoomOptions,
    enabled: isDoctor,
  });
}

/** `enabled` do caller quyết định (RoomSessionGate chỉ bật khi có ≥2 phòng, tránh gọi thừa ở quy mô nhỏ). */
export function useMyRoomSessionQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'my-room-session'),
    queryFn: getMyRoomSession,
    enabled,
  });
}

/** "Tầng" (docs/DECISIONS.md #055) — không phân trang, cùng lý do `useRoomsQuery`. */
export function useFloorsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'clinic', 'floors'), queryFn: listFloors });
}

export function useCreateFloorMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFloorRequest) => createFloor(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'floors') }),
  });
}

export function useUpdateFloorMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateFloorRequest }) => updateFloor(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'floors') });
      // Phòng hiện tên tầng ngay trong danh sách — đổi tên tầng phải phản ánh lại.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'rooms') });
    },
  });
}

/** "Bàn khám / Ghế" (docs/DECISIONS.md #055) — scoped theo `roomId`, chỉ fetch khi dialog mở (truyền `roomId` khác rỗng). */
export function useExamStationsQuery(roomId: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'exam-stations', roomId ?? ''),
    queryFn: () => listExamStations(roomId!),
    enabled: roomId !== null,
  });
}

export function useCreateExamStationMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExamStationRequest) => createExamStation(body),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'exam-stations', created.roomId) });
      // examStationCount hiện ngay ở danh sách Phòng — làm mới cùng lúc.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'rooms') });
    },
  });
}

export function useUpdateExamStationMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateExamStationRequest }) => updateExamStation(id, body),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'exam-stations', updated.roomId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'rooms') });
    },
  });
}

export function useSetRoomSessionMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SetRoomSessionRequest) => setMyRoomSession(body),
    onSuccess: (session: RoomSession) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'my-room-session'), session);
      // Danh sách bác sĩ ở Đặt lịch/Tiếp nhận hiện currentRoomName — làm mới ngay, không cần F5.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment', 'doctors') });
    },
  });
}
