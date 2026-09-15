import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWarehouseRequest, UpdateWarehouseRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createWarehouse, listWarehouses, updateWarehouse } from './warehouse.api';

export function useWarehousesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'warehouse'),
    queryFn: () => listWarehouses(),
  });
}

function useInvalidateWarehouses() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'warehouse') });
}

export function useCreateWarehouseMutation() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({ mutationFn: (body: CreateWarehouseRequest) => createWarehouse(body), onSuccess: invalidate });
}

export function useUpdateWarehouseMutation() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateWarehouseRequest }) => updateWarehouse(id, body),
    onSuccess: invalidate,
  });
}
