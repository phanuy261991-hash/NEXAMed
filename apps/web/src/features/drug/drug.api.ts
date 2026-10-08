import type {
  CreateDrugRequest,
  DrugImportCommitResponse,
  DrugImportPreviewResponse,
  DrugSummary,
  ListDrugsQuery,
  ListDrugsResponse,
  UpdateDrugRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap, uploadFile } from '../../shared/api/client';

export async function listDrugs(query: ListDrugsQuery): Promise<ListDrugsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/drugs', {
      params: {
        query: {
          q: query.q,
          itemType: query.itemType,
          includeInactive: query.includeInactive ? 'true' : undefined,
          prescriptionOnly: query.prescriptionOnly === undefined ? undefined : query.prescriptionOnly ? 'true' : 'false',
        },
      },
    }),
  ) as ListDrugsResponse;
}

export async function createDrug(body: CreateDrugRequest): Promise<DrugSummary> {
  return unwrap(await getApiClient().POST('/api/v1/drugs', { body })) as DrugSummary;
}

export async function updateDrug(id: string, body: UpdateDrugRequest): Promise<DrugSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/drugs/{id}', { params: { path: { id } }, body })) as DrugSummary;
}

/** Một mặt hàng theo id — nhẹ hơn tải cả danh sách; dùng cho `useEditedRecordGuard` (phát hiện bản ghi bị người khác sửa lúc form Sửa đang mở). */
export async function getDrug(id: string): Promise<DrugSummary> {
  return unwrap(await getApiClient().GET('/api/v1/drugs/{id}', { params: { path: { id } } })) as DrugSummary;
}

/** Nhập/Xuất Excel Thuốc & Vật tư (docs/DECISIONS.md #210) — file nhị phân/multipart nên gọi `downloadFile`/`uploadFile`, không qua client sinh từ OpenAPI. */
export async function downloadDrugImportTemplate(): Promise<void> {
  await downloadFile('/api/v1/drugs/import-template', 'mau-nhap-thuoc-vat-tu.xlsx');
}

export async function exportDrugs(): Promise<void> {
  await downloadFile('/api/v1/drugs/export', 'danh-muc-thuoc-vat-tu.xlsx');
}

export async function previewDrugImport(file: File): Promise<DrugImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<DrugImportPreviewResponse>('/api/v1/drugs/import/preview', formData);
}

export async function commitDrugImport(file: File): Promise<DrugImportCommitResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<DrugImportCommitResponse>('/api/v1/drugs/import/commit', formData);
}
