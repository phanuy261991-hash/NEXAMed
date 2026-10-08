import type {
  CreatePrintTemplateRequest,
  DeletePrintTemplateRequest,
  ListPrintTemplatesResponse,
  ListResolvedPrintTemplatesResponse,
  PrintQuickSetupRequest,
  PrintQuickSetupResponse,
  PrintTemplate,
  UpdatePrintTemplateRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../api/client';

/** Bản mẫu MẶC ĐỊNH của từng chứng từ — tự-phục vụ cho mọi nhân viên (cần để in), không cần `clinic_config.read`. */
export async function listResolvedPrintTemplates(): Promise<ListResolvedPrintTemplatesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/print-templates/resolved')) as ListResolvedPrintTemplatesResponse;
}

export async function listPrintTemplates(): Promise<ListPrintTemplatesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/print-templates')) as ListPrintTemplatesResponse;
}

export async function createPrintTemplate(body: CreatePrintTemplateRequest): Promise<PrintTemplate> {
  return unwrap(await getApiClient().POST('/api/v1/print-templates', { body })) as PrintTemplate;
}

export async function updatePrintTemplate(id: string, body: UpdatePrintTemplateRequest): Promise<PrintTemplate> {
  return unwrap(await getApiClient().PATCH('/api/v1/print-templates/{id}', { params: { path: { id } }, body })) as PrintTemplate;
}

export async function deletePrintTemplate(id: string, body: DeletePrintTemplateRequest): Promise<{ id: string }> {
  return unwrap(await getApiClient().DELETE('/api/v1/print-templates/{id}', { params: { path: { id } }, body })) as { id: string };
}

export async function quickSetupPrintTemplates(body: PrintQuickSetupRequest): Promise<PrintQuickSetupResponse> {
  return unwrap(await getApiClient().POST('/api/v1/print-templates/quick-setup', { body })) as PrintQuickSetupResponse;
}
