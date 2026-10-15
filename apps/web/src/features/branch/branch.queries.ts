import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateBranchRequest, UpdateBranchRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { STALE_OPTIONS_MS } from '../../shared/api/stale-time';
import { createBranch, listBranches, listReportScopeBranches, updateBranch } from './branch.api';

/** Danh sách chi nhánh của công ty (docs/DECISIONS.md #231) — cần quyền `branch.read` (mặc định chỉ clinic_admin). */
export function useBranchesQuery(includeInactive = false, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'branches', String(includeInactive)),
    queryFn: () => listBranches(includeInactive),
    enabled,
    staleTime: STALE_OPTIONS_MS,
  });
}

export function useCreateBranchMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBranchRequest) => createBranch(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'branches') }),
  });
}

export function useUpdateBranchMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateBranchRequest }) => updateBranch(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'branches') }),
  });
}

/** Chi nhánh để chọn ở bộ chọn "Phạm vi" của báo cáo tổng hợp (Đợt 3, #235) — chỉ gọi khi tài khoản chọn được phạm vi (`enabled`). */
export function useReportScopeBranchesQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'branches', 'report-scope-options'),
    queryFn: listReportScopeBranches,
    enabled,
    staleTime: STALE_OPTIONS_MS,
  });
}
