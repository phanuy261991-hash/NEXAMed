import type {
  AppointmentPhoneLookupResponse,
  AppointmentSummary,
  CancelAppointmentRequest,
  ClinicSettings,
  CreateAppointmentRequest,
  DoctorWorkShiftsForDateResponse,
  EditAppointmentRequest,
  ListAppointmentsResponse,
  ListDoctorsResponse,
  MarkNoShowRequest,
  RescheduleAppointmentRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listAppointments(params: {
  date?: string;
  doctorId?: string;
  cursor?: string;
  limit?: number;
}): Promise<ListAppointmentsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/appointments', { params: { query: params } }),
  ) as ListAppointmentsResponse;
}

export async function createAppointment(body: CreateAppointmentRequest): Promise<AppointmentSummary> {
  return unwrap(await getApiClient().POST('/api/v1/appointments', { body })) as AppointmentSummary;
}

export async function cancelAppointment(id: string, body: CancelAppointmentRequest): Promise<AppointmentSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/appointments/{id}/cancel', { params: { path: { id } }, body }),
  ) as AppointmentSummary;
}

export async function rescheduleAppointment(id: string, body: RescheduleAppointmentRequest): Promise<AppointmentSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/appointments/{id}/reschedule', { params: { path: { id } }, body }),
  ) as AppointmentSummary;
}

/** S5-07, APP-05 — đánh dấu "Không đến" thủ công (dùng khi tenant tắt tự động đánh dấu). */
export async function markNoShow(id: string, body: MarkNoShowRequest): Promise<AppointmentSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/appointments/{id}/no-show', { params: { path: { id } }, body }),
  ) as AppointmentSummary;
}

/** "Sửa lịch" trong ngày (khôi phục 2026-08-18) — sửa tại chỗ, cùng id, khác `rescheduleAppointment` (tạo lịch mới cho ngày khác). */
export async function editAppointment(id: string, body: EditAppointmentRequest): Promise<AppointmentSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/appointments/{id}', { params: { path: { id } }, body })) as AppointmentSummary;
}

/** S2-09 — chiếu tối thiểu, gắn quyền `appointment.read` (xem docs/DECISIONS.md). */
export async function listDoctors(): Promise<ListDoctorsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/appointments/doctors', {})) as ListDoctorsResponse;
}

/** S2-09 — cùng dữ liệu `GET /clinic-settings` nhưng gắn quyền `appointment.read`. */
export async function getScheduleConfig(): Promise<ClinicSettings> {
  return unwrap(await getApiClient().GET('/api/v1/appointments/schedule-config', {})) as ClinicSettings;
}

/** docs/DECISIONS.md #032 — tự điền tên + cảnh báo spam khi nhập SĐT lúc đặt lịch. */
export async function lookupAppointmentByPhone(phone: string): Promise<AppointmentPhoneLookupResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/appointments/lookup', { params: { query: { phone } } }),
  ) as AppointmentPhoneLookupResponse;
}

/** "Đăng ký ca làm việc" Giai đoạn 2 — dải màu ca + gạch chéo ngoài ca theo cột bác sĩ ở lưới Lịch
 * hẹn, tự-phục vụ qua `appointment.read` (xem `AppointmentService.getDoctorWorkShifts()`). */
export async function getDoctorWorkShifts(date: string): Promise<DoctorWorkShiftsForDateResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/appointments/doctor-work-shifts', { params: { query: { date } } }),
  ) as DoctorWorkShiftsForDateResponse;
}
