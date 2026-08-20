import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDepartmentRequest, UpdateDepartmentRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createDepartment, listDepartments, updateDepartment } from './department.api';

/** Chỉ đủ cho Combobox "Khoa/Phòng" trong form tài khoản (mở rộng ADM-01) — không phân trang. */
export function useDepartmentsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'departments'), queryFn: listDepartments });
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
