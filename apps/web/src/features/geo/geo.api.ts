import type { ListProvincesResponse, ListWardsResponse } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function listProvinces(): Promise<ListProvincesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/geo/provinces')) as ListProvincesResponse;
}

/** `provinceCode` bỏ trống → toàn bộ ward (dùng dựng bảng tra code→tên, xem `useAllWardsQuery`). */
export async function listWards(provinceCode?: string): Promise<ListWardsResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/geo/wards', { params: { query: { provinceCode } } }),
  ) as ListWardsResponse;
}
