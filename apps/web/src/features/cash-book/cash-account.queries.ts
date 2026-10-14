import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCashAccountRequest, UpdateCashAccountRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createCashAccount, getCashAccounts, updateCashAccount } from './cash-account.api';

export function useCashAccountsQuery(options?: { allBranches?: boolean }) {
  const { tenantId } = useAppConfig();
  const allBranches = options?.allBranches ?? false;
  return useQuery({
    queryKey: queryKey(tenantId, 'cash-account', allBranches ? 'list-all-branches' : 'list'),
    queryFn: () => getCashAccounts(allBranches),
  });
}

function useInvalidateCashAccounts() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'cash-account') });
}

export function useCreateCashAccountMutation() {
  const invalidate = useInvalidateCashAccounts();
  return useMutation({
    mutationFn: (body: CreateCashAccountRequest) => createCashAccount(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCashAccountMutation() {
  const invalidate = useInvalidateCashAccounts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCashAccountRequest }) => updateCashAccount(id, body),
    onSuccess: invalidate,
  });
}
