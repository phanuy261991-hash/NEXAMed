import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoleRequest, HideRoleRequest, RenameRoleRequest, UpdateRolePermissionsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createRole, getRoleMatrix, hideRole, listRoles, renameRole, updateRoleMatrix } from './role.api';

/** Chỉ `clinic_admin` vào được màn hình này (`role_permission.manage`) — không invalidate quá thường xuyên, đây là dữ liệu cấu hình ít đổi. */
export function useRolesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'roles'), queryFn: listRoles });
}

export function useRoleMatrixQuery(roleId: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'roles', roleId ?? undefined, 'permissions'),
    queryFn: () => getRoleMatrix(roleId!),
    enabled: roleId !== null,
  });
}

function useInvalidateRoles() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'roles') });
  };
}

export function useCreateRoleMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: (body: CreateRoleRequest) => createRole(body),
    onSuccess: invalidate,
  });
}

export function useRenameRoleMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenameRoleRequest }) => renameRole(id, body),
    onSuccess: invalidate,
  });
}

export function useHideRoleMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: HideRoleRequest }) => hideRole(id, body),
    onSuccess: invalidate,
  });
}

export function useUpdateRoleMatrixMutation() {
  const invalidate = useInvalidateRoles();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRolePermissionsRequest }) => updateRoleMatrix(id, body),
    onSuccess: invalidate,
  });
}