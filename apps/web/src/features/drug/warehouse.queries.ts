import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateWarehouseRequest, UpdateWarehouseRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { STALE_REFERENCE_MS } from '../../shared/api/stale-time';
import { createWarehouse, listWarehouses, listWarehouseTransferDestinations, updateWarehouse } from './warehouse.api';

export function useWarehousesQuery(options?: { fresh?: boolean; allBranches?: boolean }) {
  const { tenantId } = useAppConfig();
  const allBranches = options?.allBranches ?? false;
  return useQuery({
    queryKey: queryKey(tenantId, 'warehouse', allBranches ? 'all-branches' : 'current'),
    queryFn: () => listWarehouses(allBranches),
    staleTime: options?.fresh ? 0 : STALE_REFERENCE_MS, // `fresh`: màn quản trị kho luôn lấy bản mới nhất
  });
}

/** Kho đích liên chi nhánh cho form điều chuyển — mọi kho đang hoạt động của công ty (id, tên, chi nhánh). */
export function useWarehouseTransferDestinationsQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'warehouse', 'transfer-destinations'),
    queryFn: listWarehouseTransferDestinations,
    staleTime: STALE_REFERENCE_MS,
    enabled,
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
