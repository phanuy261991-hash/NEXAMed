import type {
  CreateDepartmentRequest,
  DepartmentSummary,
  ListDepartmentOptionsResponse,
  ListDepartmentsResponse,
  UpdateDepartmentRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listDepartments(): Promise<ListDepartmentsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/departments')) as ListDepartmentsResponse;
}

/** "Hàng đợi ảo" (#064) — chiếu tối thiểu, dùng được bởi mọi vai trò có `reference_catalog.read` (không cần `user_account.read`). */
export async function listDepartmentOptions(): Promise<ListDepartmentOptionsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/departments/options')) as ListDepartmentOptionsResponse;
}

export async function createDepartment(body: CreateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(await getApiClient().POST('/api/v1/departments', { body })) as DepartmentSummary;
}

export async function updateDepartment(id: string, body: UpdateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/departments/{id}', { params: { path: { id } }, body }),
  ) as DepartmentSummary;
}
