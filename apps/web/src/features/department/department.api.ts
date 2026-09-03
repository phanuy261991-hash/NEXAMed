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

/**
 * Chiếu tối thiểu, dùng được bởi mọi vai trò có `reference_catalog.read` (không cần
 * `user_account.read`). `queueOnly=true` (#107) — CHỈ dùng ở khu vực điều phối "Hàng đợi khám",
 * lọc bớt bộ phận hành chính (ví dụ "Bộ phận Lễ Tân"); mặc định `false` trả toàn bộ Khoa active.
 */
export async function listDepartmentOptions(queueOnly = false): Promise<ListDepartmentOptionsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/departments/options', { params: { query: { queueOnly } } }),
  ) as ListDepartmentOptionsResponse;
}

export async function createDepartment(body: CreateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(await getApiClient().POST('/api/v1/departments', { body })) as DepartmentSummary;
}

export async function updateDepartment(id: string, body: UpdateDepartmentRequest): Promise<DepartmentSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/departments/{id}', { params: { path: { id } }, body }),
  ) as DepartmentSummary;
}
