import type {
  EncounterInteropInfoResponse,
  InteropActionResult,
  InteropSubmissionActionResponse,
  ListInteropDoctorsResponse,
  ListInteropFacilitiesResponse,
  ListInteropSubmissionsQuery,
  ListInteropSubmissionsResponse,
  PrescriptionInteropSettingsResponse,
  PrescriptionInteropStatus,
  SaveEncounterInteropInfoRequest,
  SaveInteropCredentialRequest,
  UpdatePrescriptionInteropSettingsRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** Công tắc tổng "Có liên thông" — tự-phục vụ (mọi nhân viên đã đăng nhập). */
export async function getPrescriptionInteropStatus(): Promise<PrescriptionInteropStatus> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-interop/status')) as PrescriptionInteropStatus;
}

export async function getPrescriptionInteropSettings(): Promise<PrescriptionInteropSettingsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-interop/settings')) as PrescriptionInteropSettingsResponse;
}

export async function updatePrescriptionInteropSettings(body: UpdatePrescriptionInteropSettingsRequest): Promise<PrescriptionInteropSettingsResponse> {
  return unwrap(await getApiClient().PATCH('/api/v1/prescription-interop/settings', { body })) as PrescriptionInteropSettingsResponse;
}

export async function listInteropFacilities(): Promise<ListInteropFacilitiesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-interop/facilities')) as ListInteropFacilitiesResponse;
}

export async function saveInteropFacilityCredential(branchId: string, body: SaveInteropCredentialRequest): Promise<ListInteropFacilitiesResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/prescription-interop/facilities/{branchId}/credential', { params: { path: { branchId } }, body }),
  ) as ListInteropFacilitiesResponse;
}

export async function listInteropDoctors(): Promise<ListInteropDoctorsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-interop/doctors')) as ListInteropDoctorsResponse;
}

export async function saveInteropDoctorCredential(userId: string, body: SaveInteropCredentialRequest): Promise<ListInteropDoctorsResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/prescription-interop/doctors/{userId}/credential', { params: { path: { userId } }, body }),
  ) as ListInteropDoctorsResponse;
}

/** "Kiểm tra kết nối"/"Đăng nhập lại" — đăng nhập cơ sở thật. Trả 200 kể cả khi cổng từ chối (xem `outcome`). */
export async function loginInteropFacility(branchId: string): Promise<InteropActionResult> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-interop/facilities/{branchId}/login', { params: { path: { branchId } } })) as InteropActionResult;
}

export async function addInteropDoctorToFacility(userId: string): Promise<InteropActionResult> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-interop/doctors/{userId}/add-to-facility', { params: { path: { userId } } })) as InteropActionResult;
}

export async function removeInteropDoctorFromFacility(userId: string): Promise<InteropActionResult> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-interop/doctors/{userId}/remove-from-facility', { params: { path: { userId } } })) as InteropActionResult;
}

// ---- Ô bổ sung bắt buộc khi gửi đơn + dải kiểm dữ liệu (mockup 8a/8b) ----

export async function getEncounterInteropInfo(encounterId: string): Promise<EncounterInteropInfoResponse> {
  return unwrap(await getApiClient().GET('/api/v1/encounters/{id}/prescription-interop', { params: { path: { id: encounterId } } })) as EncounterInteropInfoResponse;
}

export async function saveEncounterInteropInfo(encounterId: string, body: SaveEncounterInteropInfoRequest): Promise<EncounterInteropInfoResponse> {
  return unwrap(await getApiClient().PUT('/api/v1/encounters/{id}/prescription-interop', { params: { path: { id: encounterId } }, body })) as EncounterInteropInfoResponse;
}

// ---- Hàng chờ gửi (mockup 8c) ----

export async function listInteropSubmissions(query: ListInteropSubmissionsQuery): Promise<ListInteropSubmissionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-interop/submissions', { params: { query } })) as ListInteropSubmissionsResponse;
}

/** "Gửi ngay". Trả 200 kể cả khi cổng từ chối/mất kết nối (xem `outcome`). */
export async function sendInteropSubmission(id: string): Promise<InteropSubmissionActionResponse> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-interop/submissions/{id}/send', { params: { path: { id } } })) as InteropSubmissionActionResponse;
}

/** "Gửi lại" sau lỗi (đặt lại số lần thử). */
export async function retryInteropSubmission(id: string): Promise<InteropSubmissionActionResponse> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-interop/submissions/{id}/retry', { params: { path: { id } } })) as InteropSubmissionActionResponse;
}
