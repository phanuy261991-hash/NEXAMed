import type {
  CheckPatientDuplicateResponse,
  CreatePatientRequest,
  ListPatientsResponse,
  PatientDetail,
  UpdatePatientRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listPatients(params: { q?: string; cursor?: string; limit?: number }): Promise<ListPatientsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients', { params: { query: params } }),
  ) as ListPatientsResponse;
}

export async function getPatient(id: string): Promise<PatientDetail> {
  return unwrap(await getApiClient().GET('/api/v1/patients/{id}', { params: { path: { id } } })) as PatientDetail;
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
