import type { CreateDepartmentTypeRequest, DepartmentTypeSummary, ListDepartmentTypesResponse, UpdateDepartmentTypeRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listDepartmentTypes(): Promise<ListDepartmentTypesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/department-types')) as ListDepartmentTypesResponse;
}

export async function createDepartmentType(body: CreateDepartmentTypeRequest): Promise<DepartmentTypeSummary> {
  return unwrap(await getApiClient().POST('/api/v1/department-types', { body })) as DepartmentTypeSummary;
}

export async function updateDepartmentType(id: string, body: UpdateDepartmentTypeRequest): Promise<DepartmentTypeSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/department-types/{id}', { params: { path: { id } }, body }),
  ) as DepartmentTypeSummary;
}