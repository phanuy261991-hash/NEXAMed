import type {
  CreatePriceListRequest,
  ItemsByGroupsRequest,
  ListPriceableGroupsResponse,
  PriceListImportPreviewResponse,
  CreateServicePackageRequest,
  ListPriceListsResponse,
  ListServicePackagesResponse,
  LookupPriceQuery,
  LookupPriceResponse,
  PriceListDetail,
  PriceListItemKind,
  PriceListStatus,
  ResolvePricesRequest,
  ResolvePricesResponse,
  SearchPriceableItemsResponse,
  ServicePackageDetail,
  UpdatePriceListRequest,
  UpdateServicePackageRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap, uploadFile } from '../../shared/api/client';

/** Cận lâm sàng GĐ2 — Gói dịch vụ + Bảng giá có thời hạn (docs/DECISIONS.md #212). */

export async function listServicePackages(params: { search?: string; includeInactive?: boolean; orderableOnly?: boolean }): Promise<ListServicePackagesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/service-packages', {
      params: {
        query: {
          search: params.search,
          includeInactive: params.includeInactive ? 'true' : 'false',
          orderableOnly: params.orderableOnly ? 'true' : 'false',
        },
      },
    }),
  ) as ListServicePackagesResponse;
}

export async function getServicePackage(id: string): Promise<ServicePackageDetail> {
  return unwrap(await getApiClient().GET('/api/v1/service-packages/{id}', { params: { path: { id } } })) as ServicePackageDetail;
}

export async function createServicePackage(body: CreateServicePackageRequest): Promise<ServicePackageDetail> {
  return unwrap(await getApiClient().POST('/api/v1/service-packages', { body })) as ServicePackageDetail;
}

export async function updateServicePackage(id: string, body: UpdateServicePackageRequest): Promise<ServicePackageDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/service-packages/{id}', { params: { path: { id } }, body })) as ServicePackageDetail;
}

export async function listPriceLists(params: { status?: PriceListStatus; search?: string }): Promise<ListPriceListsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/price-lists', { params: { query: { status: params.status, search: params.search } } })) as ListPriceListsResponse;
}

export async function getPriceList(id: string): Promise<PriceListDetail> {
  return unwrap(await getApiClient().GET('/api/v1/price-lists/{id}', { params: { path: { id } } })) as PriceListDetail;
}

export async function createPriceList(body: CreatePriceListRequest): Promise<PriceListDetail> {
  return unwrap(await getApiClient().POST('/api/v1/price-lists', { body })) as PriceListDetail;
}

export async function updatePriceList(id: string, body: UpdatePriceListRequest): Promise<PriceListDetail> {
  return unwrap(await getApiClient().PATCH('/api/v1/price-lists/{id}', { params: { path: { id } }, body })) as PriceListDetail;
}

export async function searchPriceableItems(params: { q: string; kind?: PriceListItemKind; limit?: number }): Promise<SearchPriceableItemsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/price-lists/items/search', {
      params: { query: { q: params.q, kind: params.kind, limit: params.limit === undefined ? undefined : String(params.limit) } },
    }),
  ) as SearchPriceableItemsResponse;
}

export async function lookupPrice(query: LookupPriceQuery): Promise<LookupPriceResponse> {
  return unwrap(await getApiClient().GET('/api/v1/price-lists/lookup', { params: { query } })) as LookupPriceResponse;
}

export async function resolvePrices(body: ResolvePricesRequest): Promise<ResolvePricesResponse> {
  return unwrap(await getApiClient().POST('/api/v1/price-lists/resolve', { body })) as ResolvePricesResponse;
}

/** Thêm hàng loạt vào bảng giá (docs/DECISIONS.md #212): theo nhóm + nhập Excel. File nhị phân/multipart nên gọi `downloadFile`/`uploadFile`. */
export async function listPriceableGroups(): Promise<ListPriceableGroupsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/price-lists/items/groups')) as ListPriceableGroupsResponse;
}

export async function listPriceableItemsByGroups(body: ItemsByGroupsRequest): Promise<SearchPriceableItemsResponse> {
  return unwrap(await getApiClient().POST('/api/v1/price-lists/items/by-groups', { body })) as SearchPriceableItemsResponse;
}

export async function downloadPriceListImportTemplate(): Promise<void> {
  await downloadFile('/api/v1/price-lists/import-template', 'mau-nhap-bang-gia.xlsx');
}

export async function previewPriceListImport(file: File): Promise<PriceListImportPreviewResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return uploadFile<PriceListImportPreviewResponse>('/api/v1/price-lists/import/preview', formData);
}
