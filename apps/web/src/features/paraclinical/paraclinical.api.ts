import type {
  CreateLabIndicatorRequest,
  CreateResultTemplateRequest,
  CreateTechnicalServiceRequest,
  LabIndicatorDetail,
  ListLabIndicatorsResponse,
  ListResultTemplatesResponse,
  ListTechnicalServicesResponse,
  ResultTemplateItem,
  TechnicalServiceDetail,
  TechnicalServiceImportCommitResponse,
  TechnicalServiceImportPreviewResponse,
  TechnicalServiceKind,
  UpdateLabIndicatorRequest,
  UpdateResultTemplateRequest,
  UpdateTechnicalServiceRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap, uploadFile } from '../../shared/api/client';

/** Cận lâm sàng GĐ1 — Danh mục (docs/DECISIONS.md #212). */

/** Nhập/Xuất Excel Dịch vụ kỹ thuật (docs/DECISIONS.md #276) — file nhị phân/multipart nên gọi `downloadFile`/`uploadFile`, không qua client sinh từ OpenAPI. */
export async function downloadTechnicalServiceImportTemplate(): Promise<void> {
  await downloadFile('/api/v1/technical-services/import-template', 'mau-nhap-dich-vu-ky-thuat.xlsx');
}

export async function exportTechnicalServices(): Promise<void> {
  await downloadFile('/api/v1/technical-services/export', 'danh-muc-dich-vu-ky-thuat.xlsx');
}

export async function previewTechnicalServiceImport(file: File): Promise<TechnicalServiceImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<TechnicalServiceImportPreviewResponse>('/api/v1/technical-services/import/preview', formData);
}

export async function commitTechnicalServiceImport(file: File): Promise<TechnicalServiceImportCommitResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<TechnicalServiceImportCommitResponse>('/api/v1/technical-services/import/commit', formData);
}

export interface TechnicalServiceListParams {
  kind?: TechnicalServiceKind;
  search?: string;
  /** Mã Nhóm dịch vụ (danh mục `TECH_SERVICE_CATEGORY`) — khác `kind` (Loại: Xét nghiệm/CĐHA/Thăm dò chức năng). */
  categoryCode?: string;
  inHouse?: boolean;
  includeInactive?: boolean;
}

export async function listTechnicalServices(params: TechnicalServiceListParams): Promise<ListTechnicalServicesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/technical-services', {
      params: {
        query: {
          kind: params.kind,
          search: params.search,
          categoryCode: params.categoryCode,
          inHouse: params.inHouse === undefined ? undefined : params.inHouse ? 'true' : 'false',
          includeInactive: params.includeInactive ? 'true' : 'false',
        },
      },
    }),
  ) as ListTechnicalServicesResponse;
}

export async function getTechnicalService(id: string): Promise<TechnicalServiceDetail> {
  return unwrap(await getApiClient().GET('/api/v1/technical-services/{id}', { params: { path: { id } } })) as TechnicalServiceDetail;
}

export async function createTechnicalService(body: CreateTechnicalServiceRequest): Promise<TechnicalServiceDetail> {
  return unwrap(await getApiClient().POST('/api/v1/technical-services', { body })) as TechnicalServiceDetail;
}

export async function updateTechnicalService(id: string, body: UpdateTechnicalServiceRequest): Promise<TechnicalServiceDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/technical-services/{id}', { params: { path: { id } }, body })) as TechnicalServiceDetail;
}

export async function listLabIndicators(params: { search?: string; includeInactive?: boolean }): Promise<ListLabIndicatorsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/lab-indicators', {
      params: { query: { search: params.search, includeInactive: params.includeInactive ? 'true' : 'false' } },
    }),
  ) as ListLabIndicatorsResponse;
}

export async function getLabIndicator(id: string): Promise<LabIndicatorDetail> {
  return unwrap(await getApiClient().GET('/api/v1/lab-indicators/{id}', { params: { path: { id } } })) as LabIndicatorDetail;
}

export async function createLabIndicator(body: CreateLabIndicatorRequest): Promise<LabIndicatorDetail> {
  return unwrap(await getApiClient().POST('/api/v1/lab-indicators', { body })) as LabIndicatorDetail;
}

export async function updateLabIndicator(id: string, body: UpdateLabIndicatorRequest): Promise<LabIndicatorDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/lab-indicators/{id}', { params: { path: { id } }, body })) as LabIndicatorDetail;
}

export async function listResultTemplates(params: { technicalServiceId?: string; includeInactive?: boolean }): Promise<ListResultTemplatesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/result-templates', {
      params: { query: { technicalServiceId: params.technicalServiceId, includeInactive: params.includeInactive ? 'true' : 'false' } },
    }),
  ) as ListResultTemplatesResponse;
}

export async function createResultTemplate(body: CreateResultTemplateRequest): Promise<ResultTemplateItem> {
  return unwrap(await getApiClient().POST('/api/v1/result-templates', { body })) as ResultTemplateItem;
}

export async function updateResultTemplate(id: string, body: UpdateResultTemplateRequest): Promise<ResultTemplateItem> {
  return unwrap(await getApiClient().PATCH('/api/v1/result-templates/{id}', { params: { path: { id } }, body })) as ResultTemplateItem;
}
