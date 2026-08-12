import type {
  CreateReferenceCatalogRequest,
  ListReferenceCatalogResponse,
  ReferenceCatalogCategory,
  ReferenceCatalogItem,
  UpdateReferenceCatalogRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listReferenceCatalog(
  category: ReferenceCatalogCategory,
  includeInactive?: boolean,
): Promise<ListReferenceCatalogResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/reference-catalog/{category}', {
      params: { path: { category }, query: includeInactive ? { includeInactive: 'true' } : {} },
    }),
  ) as ListReferenceCatalogResponse;
}

export async function createReferenceCatalogItem(body: CreateReferenceCatalogRequest): Promise<ReferenceCatalogItem> {
  return unwrap(await getApiClient().POST('/api/v1/reference-catalog', { body })) as ReferenceCatalogItem;
}

export async function updateReferenceCatalogItem(
  id: string,
  body: UpdateReferenceCatalogRequest,
): Promise<ReferenceCatalogItem> {
  return unwrap(
    await getApiClient().PATCH('/api/v1/reference-catalog/{id}', { params: { path: { id } }, body }),
  ) as ReferenceCatalogItem;
}

export async function deactivateReferenceCatalogItem(id: string): Promise<ReferenceCatalogItem> {
  return unwrap(
    await getApiClient().DELETE('/api/v1/reference-catalog/{id}', { params: { path: { id } } }),
  ) as ReferenceCatalogItem;
}

export async function reactivateReferenceCatalogItem(id: string): Promise<ReferenceCatalogItem> {
  return unwrap(
    await getApiClient().POST('/api/v1/reference-catalog/{id}/reactivate', { params: { path: { id } } }),
  ) as ReferenceCatalogItem;
}
