import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDepartmentRequest, UpdateDepartmentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createDepartment, listDepartmentOptions, listDepartments, updateDepartment } from './department.api';

/** Chỉ đủ cho Combobox "Khoa/Phòng" trong form tài khoản (mở rộng ADM-01) — không phân trang. Yêu cầu `user_account.read` (chỉ clinic_admin/system_admin). */
export function useDepartmentsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'departments'), queryFn: listDepartments });
}

/**
 * "Hàng đợi ảo" (#064) — chiếu tối thiểu cho khu vực Điều phối Bác sĩ/Khoa lúc Tiếp nhận
 * (`ReceptionIntakeForm.tsx`). Dùng được bởi lễ tân/bác sĩ/điều dưỡng (chỉ cần
 * `reference_catalog.read`, khác `useDepartmentsQuery()` ở trên yêu cầu `user_account.read`).
 */
export function useDepartmentOptionsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'departments', 'options'), queryFn: listDepartmentOptions });
}

export function useCreateDepartmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDepartmentRequest) => createDepartment(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'departments') });
    },
  });
}

export function useUpdateDepartmentMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDepartmentRequest }) => updateDepartment(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'departments') });
    },
  });
}
