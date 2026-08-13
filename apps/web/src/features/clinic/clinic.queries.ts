import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdateClinicSettingsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getClinicSettings, updateClinicSettings } from './clinic.api';

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
