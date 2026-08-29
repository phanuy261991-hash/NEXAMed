import type { MergePatientsRequest, MergePatientsResponse } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** S5-06, PAT-04 — gộp hồ sơ trùng. */
export async function mergePatients(body: MergePatientsRequest): Promise<MergePatientsResponse> {
  return unwrap(await getApiClient().POST('/api/v1/patients/merge', { body })) as MergePatientsResponse;
}
