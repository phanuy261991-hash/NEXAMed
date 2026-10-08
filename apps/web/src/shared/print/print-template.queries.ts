import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePrintTemplateRequest,
  DeletePrintTemplateRequest,
  PrintDocumentType,
  PrintQuickSetupRequest,
  ResolvedPrintTemplate,
  UpdatePrintTemplateRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../api/query-keys';
import { STALE_REFERENCE_MS } from '../api/stale-time';
import {
  createPrintTemplate,
  deletePrintTemplate,
  listPrintTemplates,
  listResolvedPrintTemplates,
  quickSetupPrintTemplates,
  updatePrintTemplate,
} from './print-template.api';

/**
 * Bản mẫu mặc định của MỌI chứng từ — nạp 1 lần lúc vào app (`AppShell`) để lúc bấm In đã có sẵn trong cache,
 * không phải chờ mạng (nhiều nơi gọi `window.print()` ngay sau khi render). Mọi mutation ở trang quản lý đều
 * invalidate tiền tố `[tenantId, 'print-template']` nên sửa xong là có hiệu lực ngay.
 */
export function useResolvedPrintTemplatesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'print-template', 'resolved'),
    queryFn: listResolvedPrintTemplates,
    staleTime: STALE_REFERENCE_MS,
  });
}

/** Bản mặc định đang áp dụng của MỘT chứng từ; chưa nạp xong thì `undefined` (người gọi tự có mặc định dự phòng). */
export function useResolvedPrintTemplate(documentType: PrintDocumentType): ResolvedPrintTemplate | undefined {
  const query = useResolvedPrintTemplatesQuery();
  return query.data?.items.find((i) => i.documentType === documentType);
}

export function usePrintTemplatesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'print-template', 'list'), queryFn: listPrintTemplates });
}

function useInvalidatePrintTemplates() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'print-template') });
}

export function useCreatePrintTemplateMutation() {
  const invalidate = useInvalidatePrintTemplates();
  return useMutation({ mutationFn: (body: CreatePrintTemplateRequest) => createPrintTemplate(body), onSuccess: invalidate });
}

export function useUpdatePrintTemplateMutation() {
  const invalidate = useInvalidatePrintTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePrintTemplateRequest }) => updatePrintTemplate(id, body),
    onSuccess: invalidate,
  });
}

export function useDeletePrintTemplateMutation() {
  const invalidate = useInvalidatePrintTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DeletePrintTemplateRequest }) => deletePrintTemplate(id, body),
    onSuccess: invalidate,
  });
}

export function useQuickSetupPrintTemplatesMutation() {
  const invalidate = useInvalidatePrintTemplates();
  return useMutation({ mutationFn: (body: PrintQuickSetupRequest) => quickSetupPrintTemplates(body), onSuccess: invalidate });
}
