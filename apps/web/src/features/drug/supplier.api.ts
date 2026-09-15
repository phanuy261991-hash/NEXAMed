import type { CreateSupplierRequest, ListSuppliersResponse, SupplierSummary, UpdateSupplierRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listSuppliers(includeInactive: boolean): Promise<ListSuppliersResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/suppliers', { params: { query: { includeInactive: includeInactive ? 'true' : undefined } } }),
  ) as ListSuppliersResponse;
}

export async function createSupplier(body: CreateSupplierRequest): Promise<SupplierSummary> {
  return unwrap(await getApiClient().POST('/api/v1/suppliers', { body })) as SupplierSummary;
}

export async function updateSupplier(id: string, body: UpdateSupplierRequest): Promise<SupplierSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/suppliers/{id}', { params: { path: { id } }, body })) as SupplierSummary;
}
