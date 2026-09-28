import type { CreatePrescriptionTemplateRequest, ListPrescriptionTemplatesResponse, PrescriptionTemplate, UpdatePrescriptionTemplateRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listPrescriptionTemplates(): Promise<ListPrescriptionTemplatesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/prescription-templates')) as ListPrescriptionTemplatesResponse;
}

export async function createPrescriptionTemplate(body: CreatePrescriptionTemplateRequest): Promise<PrescriptionTemplate> {
  return unwrap(await getApiClient().POST('/api/v1/prescription-templates', { body })) as PrescriptionTemplate;
}

export async function updatePrescriptionTemplate(id: string, body: UpdatePrescriptionTemplateRequest): Promise<PrescriptionTemplate> {
  return unwrap(await getApiClient().PATCH('/api/v1/prescription-templates/{id}', { params: { path: { id } }, body })) as PrescriptionTemplate;
}
