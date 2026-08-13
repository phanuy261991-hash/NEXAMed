import type { ClinicSettings, UpdateClinicSettingsRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getClinicSettings(): Promise<ClinicSettings> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-settings')) as ClinicSettings;
}

export async function updateClinicSettings(body: UpdateClinicSettingsRequest): Promise<ClinicSettings> {
  return unwrap(await getApiClient().PATCH('/api/v1/clinic-settings', { body })) as ClinicSettings;
}
