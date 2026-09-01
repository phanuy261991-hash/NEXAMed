import type {
  ClinicPrintHeader,
  ClinicProfile,
  ClinicSettings,
  CreateExamStationRequest,
  DeferredPaymentStatus,
  CreateFloorRequest,
  CreateRoomRequest,
  DoctorAvailability,
  DoctorAvailabilityBoardResponse,
  DoctorAvailabilityPolicy,
  ExamStationSummary,
  FloorSummary,
  ListExamStationsResponse,
  ListFloorsResponse,
  ListRoomOptionsResponse,
  ListRoomsResponse,
  RoomSession,
  RoomSummary,
  SetDoctorAvailabilityRequest,
  SetRoomSessionRequest,
  UpdateClinicProfileRequest,
  UpdateClinicSettingsRequest,
  UpdateExamStationRequest,
  UpdateFloorRequest,
  UpdateRoomRequest,
  CreateWorkShiftRequest,
  ListWorkShiftsResponse,
  UpdateWorkShiftRequest,
  WorkShiftItem,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

export async function getClinicSettings(): Promise<ClinicSettings> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-settings')) as ClinicSettings;
}

export async function updateClinicSettings(body: UpdateClinicSettingsRequest): Promise<ClinicSettings> {
  return unwrap(await getApiClient().PATCH('/api/v1/clinic-settings', { body })) as ClinicSettings;
}

/** Thu ngân cơ bản (Sprint 5/6) — tự-phục vụ, không cần `clinic_config.read` (đúng khuôn `GET /appointments/doctors`). */
export async function getDeferredPaymentStatus(): Promise<DeferredPaymentStatus> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-settings/deferred-payment-enabled')) as DeferredPaymentStatus;
}

/** Trang "Thông tin phòng khám" (2026-08-13) — GET/PATCH cùng contract `clinic-settings` phía trên. */
export async function getClinicProfile(): Promise<ClinicProfile> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-profile')) as ClinicProfile;
}

export async function updateClinicProfile(body: UpdateClinicProfileRequest): Promise<ClinicProfile> {
  return unwrap(await getApiClient().PATCH('/api/v1/clinic-profile', { body })) as ClinicProfile;
}

/** Tự-phục vụ (Thu ngân/Kê đơn) — không cần `clinic_config.read` (đúng khuôn `getDeferredPaymentStatus`). */
export async function getClinicPrintHeader(): Promise<ClinicPrintHeader> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-profile/print-header')) as ClinicPrintHeader;
}

/** Upload logo — multipart, xem shared/api/client.ts#uploadFile (cùng mẫu uploadPatientPhoto). */
export async function uploadClinicLogo(file: File, version: number): Promise<ClinicProfile> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<ClinicProfile>('/api/v1/clinic-profile/logo', formData);
}

export async function uploadClinicPrintLogo(file: File, version: number): Promise<ClinicProfile> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<ClinicProfile>('/api/v1/clinic-profile/print-logo', formData);
}

/** Pane "Phòng khám" (Quản trị, docs/DECISIONS.md #054) — CRUD đầy đủ, `clinic_config.*` (RoomController có sẵn từ S2-07). */
export async function listRooms(): Promise<ListRoomsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/rooms')) as ListRoomsResponse;
}

export async function createRoom(body: CreateRoomRequest): Promise<RoomSummary> {
  return unwrap(await getApiClient().POST('/api/v1/rooms', { body })) as RoomSummary;
}

export async function updateRoom(id: string, body: UpdateRoomRequest): Promise<RoomSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/rooms/{id}', { params: { path: { id } }, body })) as RoomSummary;
}

/** "Phòng làm việc hôm nay" (docs/DECISIONS.md #054) — tự-phục vụ, không cần `clinic_config.*`. */
export async function getRoomOptions(): Promise<ListRoomOptionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/rooms/options')) as ListRoomOptionsResponse;
}

export async function getMyRoomSession(): Promise<RoomSession | null> {
  return unwrap(await getApiClient().GET('/api/v1/rooms/my-session')) as RoomSession | null;
}

/** "Ca làm việc" (docs/DECISIONS.md #101) — CRUD đầy đủ, `clinic_config.*`, bảng RIÊNG theo tenant (khác `reference_catalog`). */
export async function listWorkShifts(): Promise<ListWorkShiftsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/work-shifts')) as ListWorkShiftsResponse;
}

export async function createWorkShift(body: CreateWorkShiftRequest): Promise<WorkShiftItem> {
  return unwrap(await getApiClient().POST('/api/v1/work-shifts', { body })) as WorkShiftItem;
}

export async function updateWorkShift(id: string, body: UpdateWorkShiftRequest): Promise<WorkShiftItem> {
  return unwrap(await getApiClient().PATCH('/api/v1/work-shifts/{id}', { params: { path: { id } }, body })) as WorkShiftItem;
}

export async function setMyRoomSession(body: SetRoomSessionRequest): Promise<RoomSession> {
  return unwrap(await getApiClient().PUT('/api/v1/rooms/my-session', { body })) as RoomSession;
}

/** "Tầng" (docs/DECISIONS.md #055) — cấp cha tùy chọn của `room`. */
export async function listFloors(): Promise<ListFloorsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/floors')) as ListFloorsResponse;
}

export async function createFloor(body: CreateFloorRequest): Promise<FloorSummary> {
  return unwrap(await getApiClient().POST('/api/v1/floors', { body })) as FloorSummary;
}

export async function updateFloor(id: string, body: UpdateFloorRequest): Promise<FloorSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/floors/{id}', { params: { path: { id } }, body })) as FloorSummary;
}

/** "Bàn khám / Ghế" (docs/DECISIONS.md #055) — cấp con bắt buộc thuộc 1 `room`. */
export async function listExamStations(roomId: string): Promise<ListExamStationsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/exam-stations', { params: { query: { roomId } } })) as ListExamStationsResponse;
}

export async function createExamStation(body: CreateExamStationRequest): Promise<ExamStationSummary> {
  return unwrap(await getApiClient().POST('/api/v1/exam-stations', { body })) as ExamStationSummary;
}

export async function updateExamStation(id: string, body: UpdateExamStationRequest): Promise<ExamStationSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/exam-stations/{id}', { params: { path: { id } }, body })) as ExamStationSummary;
}

/** "Tạm nghỉ / Đóng ca" — board điều phối hôm nay (chỉ liệt kê bác sĩ BREAK/ENDED; không có = ACTIVE ngầm định). */
export async function getDoctorAvailabilityToday(): Promise<DoctorAvailabilityBoardResponse> {
  return unwrap(await getApiClient().GET('/api/v1/doctor-availability/today')) as DoctorAvailabilityBoardResponse;
}

/** Tự-phục vụ — không cần `clinic_config.read` (đúng khuôn `getDeferredPaymentStatus`). */
export async function getDoctorAvailabilityPolicy(): Promise<DoctorAvailabilityPolicy> {
  return unwrap(await getApiClient().GET('/api/v1/doctor-availability/policy')) as DoctorAvailabilityPolicy;
}

export async function setDoctorAvailability(doctorId: string, body: SetDoctorAvailabilityRequest): Promise<DoctorAvailability> {
  return unwrap(
    await getApiClient().PUT('/api/v1/doctor-availability/{doctorId}', { params: { path: { doctorId } }, body }),
  ) as DoctorAvailability;
}
