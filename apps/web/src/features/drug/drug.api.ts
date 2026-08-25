import type { CreateDrugRequest, DrugSummary, ListDrugsQuery, ListDrugsResponse, UpdateDrugRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listDrugs(query: ListDrugsQuery): Promise<ListDrugsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/drugs', {
      params: { query: { q: query.q, includeInactive: query.includeInactive ? 'true' : undefined } },
    }),
  ) as ListDrugsResponse;
}

export async function createDrug(body: CreateDrugRequest): Promise<DrugSummary> {
  return unwrap(await getApiClient().POST('/api/v1/drugs', { body })) as DrugSummary;
}

export async function updateDrug(id: string, body: UpdateDrugRequest): Promise<DrugSummary> {
  return unwrap(await getApiClient().PATCH('/api/v1/drugs/{id}', { params: { path: { id } }, body })) as DrugSummary;
}
