import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateAdviceTemplateRequest, UpdateAdviceTemplateRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { createAdviceTemplate, listAdviceTemplates, updateAdviceTemplate } from './advice-template.api';

/** "Mẫu lời dặn" (docs/DECISIONS.md #222) — dùng chung toàn phòng khám; `includeInactive` chỉ người quản lý mẫu mới bật (xem cả mẫu đã ẩn để hiện lại). */
export function useAdviceTemplatesQuery(includeInactive = false) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'advice-template', String(includeInactive)),
    queryFn: () => listAdviceTemplates(includeInactive),
  });
}

function useInvalidateAdviceTemplates() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'advice-template') });
}

export function useCreateAdviceTemplateMutation() {
  const invalidate = useInvalidateAdviceTemplates();
  return useMutation({ mutationFn: (body: CreateAdviceTemplateRequest) => createAdviceTemplate(body), onSuccess: invalidate });
}

export function useUpdateAdviceTemplateMutation() {
  const invalidate = useInvalidateAdviceTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAdviceTemplateRequest }) => updateAdviceTemplate(id, body),
    onSuccess: invalidate,
  });
}
