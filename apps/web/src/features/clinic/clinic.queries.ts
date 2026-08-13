import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClinicProfile, UpdateClinicProfileRequest, UpdateClinicSettingsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  getClinicProfile,
  getClinicSettings,
  updateClinicProfile,
  updateClinicSettings,
  uploadClinicLogo,
  uploadClinicPrintLogo,
} from './clinic.api';

export function useClinicSettingsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'settings'),
    queryFn: getClinicSettings,
  });
}

export function useUpdateClinicSettingsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClinicSettingsRequest) => updateClinicSettings(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'clinic', 'settings') });
      // Lưới lịch hẹn đọc cùng dữ liệu qua GET /appointments/schedule-config (S2-09) — làm mới
      // luôn để đổi giờ làm việc/slot ở đây phản ánh ngay, không cần F5 thủ công.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'appointment', 'schedule-config') });
    },
  });
}

/** Trang "Thông tin phòng khám" (2026-08-13). */
export function useClinicProfileQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'profile'),
    queryFn: getClinicProfile,
  });
}

export function useUpdateClinicProfileMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClinicProfileRequest) => updateClinicProfile(body),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}

/** 2 mutation logo set thẳng cache, không cần refetch — cùng mẫu `useUploadPatientPhotoMutation`. */
export function useUploadClinicLogoMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, version }: { file: File; version: number }) => uploadClinicLogo(file, version),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}

export function useUploadClinicPrintLogoMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, version }: { file: File; version: number }) => uploadClinicPrintLogo(file, version),
    onSuccess: (updated: ClinicProfile) => {
      queryClient.setQueryData(queryKey(tenantId, 'clinic', 'profile'), updated);
    },
  });
}
