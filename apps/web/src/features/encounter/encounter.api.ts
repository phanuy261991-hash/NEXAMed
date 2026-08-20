import type {
  ClinicalNoteResponse,
  CompleteConsultationRequest,
  ConsultationDetailResponse,
  EncounterSummary,
  RecordVitalSignRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  VitalSignResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getConsultationDetail(id: string): Promise<ConsultationDetailResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/encounters/{id}/consultation', { params: { path: { id } } }),
  ) as ConsultationDetailResponse;
}

export async function saveDiagnoses(id: string, body: SaveDiagnosesRequest): Promise<SaveDiagnosesResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/encounters/{id}/diagnoses', { params: { path: { id } }, body }),
  ) as SaveDiagnosesResponse;
}

export async function saveClinicalNote(id: string, body: SaveClinicalNoteRequest): Promise<ClinicalNoteResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/encounters/{id}/clinical-note', { params: { path: { id } }, body }),
  ) as ClinicalNoteResponse;
}

export async function completeConsultation(id: string, body: CompleteConsultationRequest): Promise<EncounterSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/complete', { params: { path: { id } }, body }),
  ) as EncounterSummary;
}

/** REC-02/03, hạ tầng có sẵn từ Sprint 3 — dùng ở đây để bác sĩ bổ sung/đo lại sinh hiệu ngay trong màn khám. */
export async function recordVitalSigns(encounterId: string, body: RecordVitalSignRequest): Promise<VitalSignResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/reception/encounters/{encounterId}/vital-signs', {
      params: { path: { encounterId } },
      body,
    }),
  ) as VitalSignResponse;
}