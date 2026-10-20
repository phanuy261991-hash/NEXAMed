import type {
  InteropActionResult,
  ListInteropDoctorsResponse,
  ListInteropFacilitiesResponse,
  PrescriptionInteropSettingsResponse,
  PrescriptionInteropStatus,
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
