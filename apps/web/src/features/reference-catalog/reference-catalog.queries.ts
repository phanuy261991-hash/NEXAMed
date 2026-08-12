import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateReferenceCatalogRequest,
  ReferenceCatalogCategory,
  UpdateReferenceCatalogRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createReferenceCatalogItem,
  deactivateReferenceCatalogItem,
  listReferenceCatalog,
  reactivateReferenceCatalogItem,
  updateReferenceCatalogItem,
} from './reference-catalog.api';

/** Dữ liệu do `clinic_admin` sửa qua UI quản lý — không `staleTime: Infinity`, invalidate sau mỗi mutation. */
export function useReferenceCatalogQuery(category: ReferenceCatalogCategory, includeInactive?: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'reference-catalog', category, includeInactive ? 'all' : 'active'),
    queryFn: () => listReferenceCatalog(category, includeInactive),
  });
}

function useInvalidateReferenceCatalog(category: ReferenceCatalogCategory) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reference-catalog', category) });
  };
}

export function useCreateReferenceCatalogItemMutation(category: ReferenceCatalogCategory) {
  const invalidate = useInvalidateReferenceCatalog(category);
  return useMutation({
    mutationFn: (body: CreateReferenceCatalogRequest) => createReferenceCatalogItem(body),
    onSuccess: invalidate,
  });
}

export function useUpdateReferenceCatalogItemMutation(category: ReferenceCatalogCategory) {
  const invalidate = useInvalidateReferenceCatalog(category);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateReferenceCatalogRequest }) => updateReferenceCatalogItem(id, body),
    onSuccess: invalidate,
  });
}

export function useDeactivateReferenceCatalogItemMutation(category: ReferenceCatalogCategory) {
  const invalidate = useInvalidateReferenceCatalog(category);
  return useMutation({
    mutationFn: (id: string) => deactivateReferenceCatalogItem(id),
    onSuccess: invalidate,
  });
}

export function useReactivateReferenceCatalogItemMutation(category: ReferenceCatalogCategory) {
  const invalidate = useInvalidateReferenceCatalog(category);
  return useMutation({
    mutationFn: (id: string) => reactivateReferenceCatalogItem(id),
    onSuccess: invalidate,
  });
}
