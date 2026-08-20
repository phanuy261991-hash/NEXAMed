import type { CreateDepartmentRequest, DepartmentSummary, ListDepartmentsResponse, UpdateDepartmentRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listDepartments(): Promise<ListDepartmentsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/departments')) as ListDepartmentsResponse;
}

export async function createDepartment(body: CreateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(await getApiClient().POST('/api/v1/departments', { body })) as DepartmentSummary;
}

export async function updateDepartment(id: string, body: UpdateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/departments/{id}', { params: { path: { id } }, body }),
  ) as DepartmentSummary;
}
