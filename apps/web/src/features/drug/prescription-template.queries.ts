import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreatePrescriptionTemplateRequest, UpdatePrescriptionTemplateRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createPrescriptionTemplate, listPrescriptionTemplates, updatePrescriptionTemplate } from './prescription-template.api';

/** "Đơn thuốc mẫu" (Kho Thuốc GĐ5) — dùng chung toàn tenant, không cần refetch thường xuyên như `drug`. */
export function usePrescriptionTemplatesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'prescription-template'),
    queryFn: () => listPrescriptionTemplates(),
  });
}

function useInvalidatePrescriptionTemplates() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-template') });
}

export function useCreatePrescriptionTemplateMutation() {
  const invalidate = useInvalidatePrescriptionTemplates();
  return useMutation({ mutationFn: (body: CreatePrescriptionTemplateRequest) => createPrescriptionTemplate(body), onSuccess: invalidate });
}

export function useUpdatePrescriptionTemplateMutation() {
  const invalidate = useInvalidatePrescriptionTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePrescriptionTemplateRequest }) => updatePrescriptionTemplate(id, body),
    onSuccess: invalidate,
  });
}
