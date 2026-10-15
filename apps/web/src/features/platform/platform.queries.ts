import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePlatformTenantRequest, UpdatePlatformTenantRequest } from '@nexamed/shared';
import {
  createTenant,
  getTenant,
  listAuditLogs,
  listTenants,
  resetTenantAdminPassword,
  suspendTenant,
  unsuspendTenant,
  updateTenant,
} from './platform.api';

const KEY = 'platform';

export function useTenantsQuery(params: { q: string; status: 'all' | 'active' | 'suspended' }) {
  return useQuery({ queryKey: [KEY, 'tenants', params], queryFn: () => listTenants(params), placeholderData: (previous) => previous });
}

export function useTenantQuery(id: string) {
  return useQuery({ queryKey: [KEY, 'tenant', id], queryFn: () => getTenant(id) });
}

export function useAuditLogsQuery(tenantId?: string) {
  return useQuery({ queryKey: [KEY, 'audit', tenantId ?? 'all'], queryFn: () => listAuditLogs({ tenantId }) });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [KEY] });
}

export function useCreateTenantMutation() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: CreatePlatformTenantRequest) => createTenant(body), onSuccess: invalidate });
}

export function useUpdateTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (body: UpdatePlatformTenantRequest) => updateTenant(id, body), onSuccess: invalidate });
}

export function useSuspendTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (vars: { version: number; reason: string }) => suspendTenant(id, vars.version, vars.reason), onSuccess: invalidate });
}

export function useUnsuspendTenantMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (version: number) => unsuspendTenant(id, version), onSuccess: invalidate });
}

export function useResetAdminPasswordMutation(id: string) {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => resetTenantAdminPassword(id), onSuccess: invalidate });
}
