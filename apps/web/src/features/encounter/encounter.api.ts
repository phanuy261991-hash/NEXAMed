import type {
  AmendClinicalNoteRequest,
  AmendDiagnosesRequest,
  AmendPrescriptionRequest,
  ClinicalNoteResponse,
  CompleteConsultationRequest,
  ConsultationDetailResponse,
  EncounterSummary,
  PrescriptionResponse,
  RecordVitalSignRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SaveDiagnosesResponse,
  SavePrescriptionItemsRequest,
  SignPrescriptionRequest,
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

/** "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — chỉ khi đã ký (`status=COMPLETED`), bắt buộc lý do. */
export async function amendDiagnoses(id: string, body: AmendDiagnosesRequest): Promise<SaveDiagnosesResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/diagnoses/amend', { params: { path: { id } }, body }),
  ) as SaveDiagnosesResponse;
}

/** "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — chỉ sửa đúng section đổi nội dung. */
export async function amendClinicalNote(id: string, body: AmendClinicalNoteRequest): Promise<ClinicalNoteResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/clinical-note/amend', { params: { path: { id } }, body }),
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

/** Kê đơn (Sprint 4, S4-01/02/04) — xem `docs/product/future-modules-reference.md` §2.2.1 cho những gì CỐ Ý không làm (kho, hoá đơn thuốc). */
export async function savePrescriptionItems(id: string, body: SavePrescriptionItemsRequest): Promise<PrescriptionResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/encounters/{id}/prescription-items', { params: { path: { id } }, body }),
  ) as PrescriptionResponse;
}

export async function signPrescription(id: string, body: SignPrescriptionRequest): Promise<PrescriptionResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/prescription/sign', { params: { path: { id } }, body }),
  ) as PrescriptionResponse;
}

export async function printPrescription(id: string): Promise<PrescriptionResponse> {
  return unwrap(await getApiClient().POST('/api/v1/encounters/{id}/prescription/print', { params: { path: { id } } })) as PrescriptionResponse;
}

export async function amendPrescription(id: string, body: AmendPrescriptionRequest): Promise<PrescriptionResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/encounters/{id}/prescription/amend', { params: { path: { id } }, body }),
  ) as PrescriptionResponse;
}