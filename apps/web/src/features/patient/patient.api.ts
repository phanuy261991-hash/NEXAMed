import type {
  CheckPatientDuplicateResponse,
  CreatePatientRequest,
  ListPatientsResponse,
  PatientByNationalIdResponse,
  PatientByPhoneResponse,
  PatientClinicalSummaryResponse,
  PatientDetail,
  UpdatePatientRequest,
} from '@nexamed/shared';
import { ApiError, getAccessToken, getApiClient, resolveApiUrl, unwrap, uploadFile } from '../../shared/api/client';

export async function listPatients(params: {
  q?: string;
  cursor?: string;
  limit?: number;
  sort?: 'created_asc' | 'created_desc';
}): Promise<ListPatientsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients', { params: { query: params } }),
  ) as ListPatientsResponse;
}

export async function getPatient(id: string): Promise<PatientDetail> {
  return unwrap(await getApiClient().GET('/api/v1/patients/{id}', { params: { path: { id } } })) as PatientDetail;
}

/** Trang "Hồ sơ bệnh nhân" — dải KPI + bảng "Sinh hiệu theo lượt khám". */
export async function getPatientClinicalSummary(patientId: string): Promise<PatientClinicalSummaryResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/encounters/patient-clinical-summary', { params: { query: { patientId } } }),
  ) as PatientClinicalSummaryResponse;
}

/**
 * "Xuất bệnh án PDF" (S6-06, ADM-05) — POST kèm `reason` ở BODY, KHÔNG phải query string
 * (`.claude/docs/security-audit.md`: cấm PII/PHI vào URL — lý do xuất nhân viên gõ tay có thể vô
 * tình chứa tên/chẩn đoán bệnh nhân). Tự gọi `fetch` (không qua `downloadFile()` dùng chung — endpoint
 * trả `.pdf` nhị phân qua `@Res()`, không có envelope `{data,meta}`; viết riêng ở đây thay vì mở
 * rộng `downloadFile()`/`client.ts` để không đè thêm byte vào chunk khởi động, chỉ chunk lazy của
 * trang "Hồ sơ bệnh nhân" phải tải thêm).
 */
export async function exportPatientMedicalRecord(patientId: string, reason: string): Promise<void> {
  const token = getAccessToken();
  const response = await fetch(`${resolveApiUrl('/api/v1/encounters/patient-medical-record/export')}?patientId=${patientId}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiError(err?.code ?? 'UNKNOWN_ERROR', err?.message ?? 'Không xuất được bệnh án.', err?.details);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const filename = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? `benh-an-${patientId}.pdf`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function createPatient(body: CreatePatientRequest): Promise<PatientDetail> {
  return unwrap(await getApiClient().POST('/api/v1/patients', { body })) as PatientDetail;
}

export async function updatePatient(id: string, body: UpdatePatientRequest): Promise<PatientDetail> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/patients/{id}', { params: { path: { id } }, body }),
  ) as PatientDetail;
}

/** PAT-03 — gọi lúc bấm Lưu trên form tạo mới, KHÔNG chặn tạo (chỉ cảnh báo). */
export async function checkPatientDuplicate(fullName: string, dob: string): Promise<CheckPatientDuplicateResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/check-duplicate', { params: { query: { fullName, dob } } }),
  ) as CheckPatientDuplicateResponse;
}

/**
 * Tra trùng SĐT (KHÁC PAT-03 — SĐT được phép trùng thật sự, không phải "nghi trùng hồ sơ") — dùng
 * ở cảnh báo mềm form Thêm/Sửa VÀ để chọn khách hàng ở trang Tiếp nhận (Sprint 3).
 */
export async function findPatientsByPhone(phone: string, excludePatientId?: string): Promise<PatientByPhoneResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/by-phone', { params: { query: { phone, excludePatientId } } }),
  ) as PatientByPhoneResponse;
}

/** Tra trùng CCCD (màn hình "Tiếp nhận bệnh nhân", mockup đã duyệt) — cùng khuôn `findPatientsByPhone`. */
export async function findPatientsByNationalId(nationalId: string, excludePatientId?: string): Promise<PatientByNationalIdResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/by-national-id', { params: { query: { nationalId, excludePatientId } } }),
  ) as PatientByNationalIdResponse;
}

/** Upload/thay ảnh đại diện (docs/DECISIONS.md #034) — multipart, xem shared/api/client.ts#uploadFile. */
export async function uploadPatientPhoto(id: string, file: File, version: number): Promise<PatientDetail> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<PatientDetail>(`/api/v1/patients/${id}/photo`, formData);
}
