import type { CreateWarehouseRequest, ListWarehousesResponse, UpdateWarehouseRequest, WarehouseSummary } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listWarehouses(): Promise<ListWarehousesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/warehouses', {})) as ListWarehousesResponse;
}

export async function createWarehouse(body: CreateWarehouseRequest): Promise<WarehouseSummary> {
  return unwrap(await getApiClient().POST('/api/v1/warehouses', { body })) as WarehouseSummary;
}

export async function updateWarehouse(id: string, body: UpdateWarehouseRequest): Promise<WarehouseSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/warehouses/{id}', { params: { path: { id } }, body })) as WarehouseSummary;
}
