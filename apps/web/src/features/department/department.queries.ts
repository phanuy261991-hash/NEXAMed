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
 * Chiếu tối thiểu, dùng được bởi lễ tân/bác sĩ/điều dưỡng (chỉ cần `reference_catalog.read`, khác
 * `useDepartmentsQuery()` ở trên yêu cầu `user_account.read`). `queueOnly=true` (#107) — CHỈ dùng
 * ở khu vực điều phối "Hàng đợi khám" (`ReceptionIntakeForm.tsx` và tương tự) — lọc bớt bộ phận
 * hành chính; mặc định `false` (ví dụ `MyAccountDialog.tsx` tự xem hồ sơ cần thấy đủ mọi Khoa).
 */
export function useDepartmentOptionsQuery(queueOnly = false) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'departments', 'options', String(queueOnly)),
    queryFn: () => listDepartmentOptions(queueOnly),
  });
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
