import type {
  GetParaclinicalResultResponse,
  ListPatientIndicatorsResponse,
  ListPatientParaclinicalResultsQuery,
  ListPatientParaclinicalResultsResponse,
  PatientIndicatorTrendQuery,
  PatientIndicatorTrendResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';
import type { ParaclinicalGroup } from './paraclinical-group';

/**
 * Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234): kết quả ĐÃ DUYỆT theo BỆNH NHÂN, mọi chi nhánh. Mỗi nhóm có đường dẫn + quyền riêng
 * (`/paraclinical/lab/patients/...`, `/paraclinical/imaging/patients/...`); client sinh từ OpenAPI chỉ nhận đường dẫn hằng nên mỗi hàm rẽ nhánh theo nhóm.
 */

export type PatientParaclinicalResultsParams = Omit<ListPatientParaclinicalResultsQuery, 'cursor' | 'limit' | 'abnormalOnly'> & { abnormalOnly: boolean };

export async function listPatientParaclinicalResults(
  group: ParaclinicalGroup,
  patientId: string,
  params: PatientParaclinicalResultsParams & { cursor?: string; limit: number },
): Promise<ListPatientParaclinicalResultsResponse> {
  const client = getApiClient();
  // Query string chỉ mang chuỗi: cờ `abnormalOnly` gửi dạng 'true'/'false' (API tự đổi lại thành boolean).
  const query = { ...params, abnormalOnly: params.abnormalOnly ? ('true' as const) : ('false' as const) };
  const args = { params: { path: { patientId }, query } };
  const res =
    group === 'lab' ? await client.GET('/api/v1/paraclinical/lab/patients/{patientId}/results', args) : await client.GET('/api/v1/paraclinical/imaging/patients/{patientId}/results', args);
  return unwrap(res) as ListPatientParaclinicalResultsResponse;
}

export async function listPatientIndicators(patientId: string): Promise<ListPatientIndicatorsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/paraclinical/lab/patients/{patientId}/indicators', { params: { path: { patientId } } })) as ListPatientIndicatorsResponse;
}

export async function getPatientIndicatorTrend(patientId: string, query: PatientIndicatorTrendQuery): Promise<PatientIndicatorTrendResponse> {
  return unwrap(await getApiClient().GET('/api/v1/paraclinical/lab/patients/{patientId}/indicators/trend', { params: { path: { patientId }, query } })) as PatientIndicatorTrendResponse;
}

/** Mở một kết quả đã duyệt của bệnh nhân (kể cả của chi nhánh khác) — cùng dạng phản hồi với màn xem kết quả ở menu cận lâm sàng. */
export async function getPatientParaclinicalResult(group: ParaclinicalGroup, patientId: string, itemId: string): Promise<GetParaclinicalResultResponse> {
  const client = getApiClient();
  const args = { params: { path: { patientId, itemId } } };
  const res =
    group === 'lab'
      ? await client.GET('/api/v1/paraclinical/lab/patients/{patientId}/items/{itemId}/result', args)
      : await client.GET('/api/v1/paraclinical/imaging/patients/{patientId}/items/{itemId}/result', args);
  return unwrap(res) as GetParaclinicalResultResponse;
}

export async function recordPatientParaclinicalPrint(group: ParaclinicalGroup, patientId: string, itemId: string): Promise<void> {
  const client = getApiClient();
  const args = { params: { path: { patientId, itemId } } };
  unwrap(
    group === 'lab'
      ? await client.POST('/api/v1/paraclinical/lab/patients/{patientId}/items/{itemId}/result/print', args)
      : await client.POST('/api/v1/paraclinical/imaging/patients/{patientId}/items/{itemId}/result/print', args),
  );
}
