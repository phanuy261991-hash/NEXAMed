import type {
  CreateInsuranceCardRequest,
  EncounterInsurance,
  InsuranceCardPhotoSide,
  ListInsuranceCardsResponse,
  SaveInsuranceCardResponse,
  UpdateInsuranceCardRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

/** Thẻ BHYT của bệnh nhân (S2-04, docs/DECISIONS.md #243) — thẻ theo bệnh nhân nên chung cả công ty (không có chi nhánh). */
export async function listInsuranceCards(patientId: string): Promise<ListInsuranceCardsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/patients/{patientId}/insurance-cards', { params: { path: { patientId } } }),
  ) as ListInsuranceCardsResponse;
}

export async function createInsuranceCard(patientId: string, body: CreateInsuranceCardRequest): Promise<SaveInsuranceCardResponse> {
  return unwrap(
    await getApiClient().POST('/api/v1/patients/{patientId}/insurance-cards', { params: { path: { patientId } }, body }),
  ) as SaveInsuranceCardResponse;
}

export async function updateInsuranceCard(patientId: string, cardId: string, body: UpdateInsuranceCardRequest): Promise<SaveInsuranceCardResponse> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/patients/{patientId}/insurance-cards/{cardId}', { params: { path: { patientId, cardId } }, body }),
  ) as SaveInsuranceCardResponse;
}

export async function removeInsuranceCard(patientId: string, cardId: string, version: number): Promise<void> {
  unwrap(
    await getApiClient().DELETE('/api/v1/patients/{patientId}/insurance-cards/{cardId}', {
      params: { path: { patientId, cardId }, query: { version } },
    }),
  );
}

/** Ảnh thẻ (mặt trước/sau) — chỉ JPG/PNG, tối đa 3MB (máy chủ kiểm magic byte). */
export async function uploadInsuranceCardPhoto(patientId: string, cardId: string, side: InsuranceCardPhotoSide, version: number, file: File): Promise<SaveInsuranceCardResponse> {
  const form = new FormData();
  form.append('side', side);
  form.append('version', String(version));
  form.append('file', file);
  return uploadFile<SaveInsuranceCardResponse>(`/api/v1/patients/${patientId}/insurance-cards/${cardId}/photo`, form);
}

/** Thẻ đã chụp của một lượt khám để IN trên phiếu thu — `null` khi công tắc "Áp dụng BHYT" tắt. */
export async function getInvoiceInsurance(encounterId: string): Promise<EncounterInsurance | null> {
  return unwrap(
    await getApiClient().GET('/api/v1/billing/invoices/{encounterId}/insurance', { params: { path: { encounterId } } }),
  ) as EncounterInsurance | null;
}
