import type {
  CancelEncounterRequest,
  CheckInRequest,
  EncounterSummary,
  ReassignEncounterRequest,
  ReceptionListResponse,
  RegisterReceptionRequest,
  ReleaseEncounterRequest,
  StartConsultationRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

export async function checkIn(body: CheckInRequest): Promise<EncounterSummary> {
  return unwrap(await getApiClient().POST('/api/v1/reception/check-in', { body })) as EncounterSummary;
}

export async function registerReception(body: RegisterReceptionRequest): Promise<EncounterSummary> {
  return unwrap(await getApiClient().POST('/api/v1/reception/direct', { body })) as EncounterSummary;
}

export async function getReceptionList(
  date?: string,
  doctorId?: string,
  includeDepartmentPool?: boolean,
  queueView?: boolean,
): Promise<ReceptionListResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/reception/list', { params: { query: { date, doctorId, includeDepartmentPool, queueView } } }),
  ) as ReceptionListResponse;
}

/** "Xuất Excel" — LUÔN toàn bộ ngày `date` (bỏ qua tab/tìm kiếm đang chọn trên màn hình, chốt qua
 * AskUserQuestion) — tải file thô qua `downloadFile()`, KHÔNG qua client sinh từ OpenAPI (endpoint
 * trả `.xlsx` nhị phân qua `@Res()`, không có envelope `{data,meta}`), đúng khuôn `cash-flow-report.api.ts`. */
export async function exportReceptionList(date: string): Promise<void> {
  await downloadFile(`/api/v1/reception/list/export?date=${date}`, `benh-nhan-trong-ngay-${date}.xlsx`);
}

export async function startConsultation(id: string, body: StartConsultationRequest): Promise<EncounterSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/start', { params: { path: { id } }, body }),
  ) as EncounterSummary;
}

export async function cancelEncounter(id: string, body: CancelEncounterRequest): Promise<EncounterSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/cancel', { params: { path: { id } }, body }),
  ) as EncounterSummary;
}

/** #085 "Trả về hàng chờ" — bác sĩ nhả ca nhận nhầm/bận đột xuất, KHÁC "Khách bỏ về" (không huỷ gì). */
export async function releaseEncounter(id: string, body: ReleaseEncounterRequest): Promise<EncounterSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/release', { params: { path: { id } }, body }),
  ) as EncounterSummary;
}

/** "Trung tâm Điều phối Tiếp nhận" — lễ tân đổi bác sĩ/Khoa phụ trách, chỉ khi còn CHECKED_IN. */
export async function reassignEncounter(id: string, body: ReassignEncounterRequest): Promise<EncounterSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/encounters/{id}/reassign', { params: { path: { id } }, body }),
  ) as EncounterSummary;
}
