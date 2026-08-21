import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateAllergenGroupRequest, CreateAllergenRequest, UpdateAllergenGroupRequest, UpdateAllergenRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createAllergen,
  createAllergenGroup,
  deactivateAllergen,
  deactivateAllergenGroup,
  listAllergenGroups,
  listAllergens,
  reactivateAllergen,
  reactivateAllergenGroup,
  updateAllergen,
  updateAllergenGroup,
} from './allergen.api';

/** Dữ liệu do `clinic_admin` sửa qua UI quản lý — không `staleTime: Infinity`, invalidate sau mỗi mutation. */
export function useAllergenGroupsQuery(includeInactive?: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'allergen-group', includeInactive ? 'all' : 'active'),
    queryFn: () => listAllergenGroups(includeInactive),
  });
}

export function useAllergensQuery(includeInactive?: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'allergen', includeInactive ? 'all' : 'active'),
    queryFn: () => listAllergens(includeInactive),
  });
}

function useInvalidateAllergenCatalog() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'allergen-group') });
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'allergen') });
  };
}

export function useCreateAllergenGroupMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (body: CreateAllergenGroupRequest) => createAllergenGroup(body), onSuccess: invalidate });
}

export function useUpdateAllergenGroupMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAllergenGroupRequest }) => updateAllergenGroup(id, body),
    onSuccess: invalidate,
  });
}

export function useDeactivateAllergenGroupMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (id: string) => deactivateAllergenGroup(id), onSuccess: invalidate });
}

export function useReactivateAllergenGroupMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (id: string) => reactivateAllergenGroup(id), onSuccess: invalidate });
}

export function useCreateAllergenMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (body: CreateAllergenRequest) => createAllergen(body), onSuccess: invalidate });
}

export function useUpdateAllergenMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAllergenRequest }) => updateAllergen(id, body),
    onSuccess: invalidate,
  });
}

export function useDeactivateAllergenMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (id: string) => deactivateAllergen(id), onSuccess: invalidate });
}

export function useReactivateAllergenMutation() {
  const invalidate = useInvalidateAllergenCatalog();
  return useMutation({ mutationFn: (id: string) => reactivateAllergen(id), onSuccess: invalidate });
}
