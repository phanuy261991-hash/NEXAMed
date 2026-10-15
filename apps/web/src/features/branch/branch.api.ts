import type { BranchSummary, CreateBranchRequest, ListBranchesResponse, UpdateBranchRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** `includeInactive=true` kèm cả chi nhánh đã ngưng (màn quản trị); mặc định chỉ chi nhánh đang hoạt động (chọn trong form tài khoản). */
export async function listBranches(includeInactive = false): Promise<ListBranchesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/branches', { params: { query: { includeInactive: includeInactive ? 'true' : 'false' } } }),
  ) as ListBranchesResponse;
}

export async function createBranch(body: CreateBranchRequest): Promise<BranchSummary> {
  return unwrap(await getApiClient().POST('/api/v1/branches', { body })) as BranchSummary;
}

export async function updateBranch(id: string, body: UpdateBranchRequest): Promise<BranchSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/branches/{id}', { params: { path: { id } }, body })) as BranchSummary;
}

/** Chi nhánh cho bộ chọn "Phạm vi" của báo cáo tổng hợp (Đợt 3, #235) — mọi chi nhánh của công ty, cần `company_report.read` (KHÔNG cần `branch.read`). */
export async function listReportScopeBranches(): Promise<ListBranchesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/branches/report-scope-options')) as ListBranchesResponse;
}
