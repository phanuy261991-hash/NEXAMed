import type { CreateWarehouseRequest, ListWarehouseTransferDestinationsResponse, ListWarehousesResponse, UpdateWarehouseRequest, WarehouseSummary } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** `allBranches`: liệt kê kho của MỌI chi nhánh tài khoản được gán (màn quản trị); mặc định chỉ chi nhánh đang làm việc (docs/DECISIONS.md #233). */
export async function listWarehouses(allBranches = false): Promise<ListWarehousesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/warehouses', { params: { query: allBranches ? { allBranches: true } : {} } })) as ListWarehousesResponse;
}

/** Ô chọn KHO NHẬN của phiếu điều chuyển — mọi kho đang hoạt động của công ty, kể cả chi nhánh khác. */
export async function listWarehouseTransferDestinations(): Promise<ListWarehouseTransferDestinationsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/warehouses/transfer-destinations', {})) as ListWarehouseTransferDestinationsResponse;
}

export async function createWarehouse(body: CreateWarehouseRequest): Promise<WarehouseSummary> {
  return unwrap(await getApiClient().POST('/api/v1/warehouses', { body })) as WarehouseSummary;
}

export async function updateWarehouse(id: string, body: UpdateWarehouseRequest): Promise<WarehouseSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/warehouses/{id}', { params: { path: { id } }, body })) as WarehouseSummary;
}

/** Một kho theo id — dùng cho `useEditedRecordGuard`. */
export async function getWarehouse(id: string): Promise<WarehouseSummary> {
  return unwrap(await getApiClient().GET('/api/v1/warehouses/{id}', { params: { path: { id } } })) as WarehouseSummary;
}
