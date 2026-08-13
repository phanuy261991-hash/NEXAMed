import type {
  CancelEncounterRequest,
  CheckInRequest,
  EncounterSummary,
  ReceptionListResponse,
  RegisterReceptionRequest,
  StartConsultationRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function checkIn(body: CheckInRequest): Promise<EncounterSummary> {
  return unwrap(await getApiClient().POST('/api/v1/reception/check-in', { body })) as EncounterSummary;
}

export async function registerReception(body: RegisterReceptionRequest): Promise<EncounterSummary> {
  return unwrap(await getApiClient().POST('/api/v1/reception/direct', { body })) as EncounterSummary;
}

export async function getReceptionList(date?: string, doctorId?: string): Promise<ReceptionListResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/reception/list', { params: { query: { date, doctorId } } }),
  ) as ReceptionListResponse;
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
