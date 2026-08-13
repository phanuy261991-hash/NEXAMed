import type { ClinicProfile, ClinicSettings, UpdateClinicProfileRequest, UpdateClinicSettingsRequest } from '@nexamed/shared';
import { getApiClient, unwrap, uploadFile } from '../../shared/api/client';

export async function getClinicSettings(): Promise<ClinicSettings> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-settings')) as ClinicSettings;
}

export async function updateClinicSettings(body: UpdateClinicSettingsRequest): Promise<ClinicSettings> {
  return unwrap(await getApiClient().PATCH('/api/v1/clinic-settings', { body })) as ClinicSettings;
}

/** Trang "Thông tin phòng khám" (2026-08-13) — GET/PATCH cùng contract `clinic-settings` phía trên. */
export async function getClinicProfile(): Promise<ClinicProfile> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-profile')) as ClinicProfile;
}

export async function updateClinicProfile(body: UpdateClinicProfileRequest): Promise<ClinicProfile> {
  return unwrap(await getApiClient().PATCH('/api/v1/clinic-profile', { body })) as ClinicProfile;
}

/** Upload logo — multipart, xem shared/api/client.ts#uploadFile (cùng mẫu uploadPatientPhoto). */
export async function uploadClinicLogo(file: File, version: number): Promise<ClinicProfile> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<ClinicProfile>('/api/v1/clinic-profile/logo', formData);
}

export async function uploadClinicPrintLogo(file: File, version: number): Promise<ClinicProfile> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('version', String(version));
  return uploadFile<ClinicProfile>('/api/v1/clinic-profile/print-logo', formData);
}
