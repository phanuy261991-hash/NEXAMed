import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDepartmentTypeRequest, UpdateDepartmentTypeRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createDepartmentType, listDepartmentTypes, updateDepartmentType } from './department-type.api';

export function useDepartmentTypesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'department-types'), queryFn: listDepartmentTypes });
}

function useInvalidateDepartmentTypes() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'department-types') });
  };
}

export function useCreateDepartmentTypeMutation() {
  const invalidate = useInvalidateDepartmentTypes();
  return useMutation({
    mutationFn: (body: CreateDepartmentTypeRequest) => createDepartmentType(body),
    onSuccess: invalidate,
  });
}

export function useUpdateDepartmentTypeMutation() {
  const invalidate = useInvalidateDepartmentTypes();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDepartmentTypeRequest }) => updateDepartmentType(id, body),
    onSuccess: invalidate,
  });
}