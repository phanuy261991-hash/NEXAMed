import type { AdviceTemplate, CreateAdviceTemplateRequest, ListAdviceTemplatesResponse, UpdateAdviceTemplateRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** "Mẫu lời dặn" (docs/DECISIONS.md #222) — dùng chung toàn phòng khám. */
export async function listAdviceTemplates(includeInactive = false): Promise<ListAdviceTemplatesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/advice-templates', { params: { query: { includeInactive } } })) as ListAdviceTemplatesResponse;
}

export async function createAdviceTemplate(body: CreateAdviceTemplateRequest): Promise<AdviceTemplate> {
  return unwrap(await getApiClient().POST('/api/v1/advice-templates', { body })) as AdviceTemplate;
}

export async function updateAdviceTemplate(id: string, body: UpdateAdviceTemplateRequest): Promise<AdviceTemplate> {
  return unwrap(await getApiClient().PATCH('/api/v1/advice-templates/{id}', { params: { path: { id } }, body })) as AdviceTemplate;
}
