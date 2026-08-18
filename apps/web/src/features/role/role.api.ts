import type {
  CreateRoleRequest,
  HideRoleRequest,
  ListRolesResponse,
  RenameRoleRequest,
  RoleSummary,
  RoleWithMatrixResponse,
  UpdateRolePermissionsRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listRoles(): Promise<ListRolesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/roles')) as ListRolesResponse;
}

export async function createRole(body: CreateRoleRequest): Promise<RoleSummary> {
  return unwrap(await getApiClient().POST('/api/v1/roles', { body })) as RoleSummary;
}

export async function renameRole(id: string, body: RenameRoleRequest): Promise<RoleSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/roles/{id}', { params: { path: { id } }, body })) as RoleSummary;
}

export async function hideRole(id: string, body: HideRoleRequest): Promise<void> {
  await getApiClient().POST('/api/v1/roles/{id}/hide', { params: { path: { id } }, body });
}

export async function getRoleMatrix(id: string): Promise<RoleWithMatrixResponse> {
  return unwrap(await getApiClient().GET('/api/v1/roles/{id}/permissions', { params: { path: { id } } })) as RoleWithMatrixResponse;
}

export async function updateRoleMatrix(id: string, body: UpdateRolePermissionsRequest): Promise<RoleWithMatrixResponse> {
  return unwrap(
    await getApiClient().PUT('/api/v1/roles/{id}/permissions', { params: { path: { id } }, body }),
  ) as RoleWithMatrixResponse;
}