import type {
  EncounterConsumptionResponse,
  PutServiceNormRequest,
  RecordConsumptionRequest,
  ReverseConsumptionRequest,
  ServiceNormQuery,
  ServiceNormResponse,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getServiceNorm(query: ServiceNormQuery): Promise<ServiceNormResponse> {
  return unwrap(await getApiClient().GET('/api/v1/service-consumption/norms', { params: { query } })) as ServiceNormResponse;
}

export async function putServiceNorm(query: ServiceNormQuery, body: PutServiceNormRequest): Promise<ServiceNormResponse> {
  return unwrap(await getApiClient().PUT('/api/v1/service-consumption/norms', { params: { query }, body })) as ServiceNormResponse;
}

export async function getEncounterConsumption(encounterId: string): Promise<EncounterConsumptionResponse> {
  return unwrap(await getApiClient().GET('/api/v1/service-consumption/encounters/{encounterId}', { params: { path: { encounterId } } })) as EncounterConsumptionResponse;
}

/** Ghi vật tư đã dùng của MỘT lượt dịch vụ — máy chủ trả lại danh sách dịch vụ của lượt khám đã cập nhật. */
export async function recordConsumption(body: RecordConsumptionRequest): Promise<EncounterConsumptionResponse> {
  return unwrap(await getApiClient().POST('/api/v1/service-consumption/records', { body })) as EncounterConsumptionResponse;
}

/** Đảo phiếu tiêu hao (có lý do) — hoàn kho; trả lại danh sách dịch vụ của lượt khám đã cập nhật. */
export async function reverseConsumption(issueId: string, body: ReverseConsumptionRequest): Promise<EncounterConsumptionResponse> {
  return unwrap(await getApiClient().POST('/api/v1/service-consumption/records/{issueId}/reverse', { params: { path: { issueId } }, body })) as EncounterConsumptionResponse;
}
