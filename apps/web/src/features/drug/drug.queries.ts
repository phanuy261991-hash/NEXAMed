import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDrugRequest, UpdateDrugRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createDrug, listDrugs, updateDrug } from './drug.api';

/** Dữ liệu do `clinic_admin` sửa qua UI quản lý — không `staleTime: Infinity`, invalidate sau mỗi mutation. */
export function useDrugsQuery(params: { q?: string; includeInactive?: boolean } = {}) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'drug', params.q ?? '', params.includeInactive ? 'all' : 'active'),
    queryFn: () => listDrugs({ q: params.q, includeInactive: params.includeInactive ?? false }),
  });
}

function useInvalidateDrugs() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'drug') });
}

export function useCreateDrugMutation() {
  const invalidate = useInvalidateDrugs();
  return useMutation({ mutationFn: (body: CreateDrugRequest) => createDrug(body), onSuccess: invalidate });
}

export function useUpdateDrugMutation() {
  const invalidate = useInvalidateDrugs();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDrugRequest }) => updateDrug(id, body),
    onSuccess: invalidate,
  });
}
