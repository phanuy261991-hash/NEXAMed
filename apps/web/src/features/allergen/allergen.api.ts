import type {
  AllergenGroupSummary,
  AllergenItem,
  CreateAllergenGroupRequest,
  CreateAllergenRequest,
  ListAllergenGroupsResponse,
  ListAllergensResponse,
  UpdateAllergenGroupRequest,
  UpdateAllergenRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listAllergenGroups(includeInactive?: boolean): Promise<ListAllergenGroupsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/allergen-groups', { params: { query: includeInactive ? { includeInactive: 'true' } : {} } }),
  ) as ListAllergenGroupsResponse;
}

export async function createAllergenGroup(body: CreateAllergenGroupRequest): Promise<AllergenGroupSummary> {
  return unwrap(await getApiClient().POST('/api/v1/allergen-groups', { body })) as AllergenGroupSummary;
}

export async function updateAllergenGroup(id: string, body: UpdateAllergenGroupRequest): Promise<AllergenGroupSummary> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/allergen-groups/{id}', { params: { path: { id } }, body }),
  ) as AllergenGroupSummary;
}

export async function deactivateAllergenGroup(id: string): Promise<AllergenGroupSummary> {
  return unwrap(
    await getApiClient().DELETE('/api/v1/allergen-groups/{id}', { params: { path: { id } } }),
  ) as AllergenGroupSummary;
}

export async function reactivateAllergenGroup(id: string): Promise<AllergenGroupSummary> {
  return unwrap(
    await getApiClient().POST('/api/v1/allergen-groups/{id}/reactivate', { params: { path: { id } } }),
  ) as AllergenGroupSummary;
}

export async function listAllergens(includeInactive?: boolean): Promise<ListAllergensResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/allergens', { params: { query: includeInactive ? { includeInactive: 'true' } : {} } }),
  ) as ListAllergensResponse;
}

export async function createAllergen(body: CreateAllergenRequest): Promise<AllergenItem> {
  return unwrap(await getApiClient().POST('/api/v1/allergens', { body })) as AllergenItem;
}

export async function updateAllergen(id: string, body: UpdateAllergenRequest): Promise<AllergenItem> {
  return unwrap(await getApiClient().PATCH('/api/v1/allergens/{id}', { params: { path: { id } }, body })) as AllergenItem;
}

export async function deactivateAllergen(id: string): Promise<AllergenItem> {
  return unwrap(await getApiClient().DELETE('/api/v1/allergens/{id}', { params: { path: { id } } })) as AllergenItem;
}

export async function reactivateAllergen(id: string): Promise<AllergenItem> {
  return unwrap(
    await getApiClient().POST('/api/v1/allergens/{id}/reactivate', { params: { path: { id } } }),
  ) as AllergenItem;
}
