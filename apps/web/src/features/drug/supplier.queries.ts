import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSupplierRequest, UpdateSupplierRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createSupplier, listSuppliers, updateSupplier } from './supplier.api';

export function useSuppliersQuery(includeInactive = false) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'supplier', includeInactive ? 'all' : 'active'),
    queryFn: () => listSuppliers(includeInactive),
  });
}

function useInvalidateSuppliers() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'supplier') });
}

export function useCreateSupplierMutation() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({ mutationFn: (body: CreateSupplierRequest) => createSupplier(body), onSuccess: invalidate });
}

export function useUpdateSupplierMutation() {
  const invalidate = useInvalidateSuppliers();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateSupplierRequest }) => updateSupplier(id, body),
    onSuccess: invalidate,
  });
}
