import type {
  ListIcd10ChaptersResponse,
  ListIcd10CodesResponse,
  ListIcd10GroupsResponse,
  SearchIcd10Response,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listIcd10Chapters(): Promise<ListIcd10ChaptersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/icd10/chapters')) as ListIcd10ChaptersResponse;
}

export async function listIcd10Groups(chapterCode: string): Promise<ListIcd10GroupsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/icd10/groups', { params: { query: { chapterCode } } }),
  ) as ListIcd10GroupsResponse;
}

export async function listIcd10Codes(groupCode: string): Promise<ListIcd10CodesResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/icd10/codes', { params: { query: { groupCode } } }),
  ) as ListIcd10CodesResponse;
}

export async function searchIcd10(q: string): Promise<SearchIcd10Response> {
  return unwrap(await getApiClient().GET('/api/v1/icd10', { params: { query: { q } } })) as SearchIcd10Response;
}