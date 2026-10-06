import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateLabIndicatorRequest,
  CreateResultTemplateRequest,
  CreateTechnicalServiceRequest,
  UpdateLabIndicatorRequest,
  UpdateResultTemplateRequest,
  UpdateTechnicalServiceRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createLabIndicator,
  createResultTemplate,
  createTechnicalService,
  getLabIndicator,
  getTechnicalService,
  listLabIndicators,
  listResultTemplates,
  listTechnicalServices,
  updateLabIndicator,
  updateResultTemplate,
  updateTechnicalService,
  type TechnicalServiceListParams,
} from './paraclinical.api';

/** Cận lâm sàng GĐ1 — Danh mục (docs/DECISIONS.md #212). Mọi truy vấn lấy dữ liệu MỚI khi mở màn quản trị
 * (`staleTime: 0` mặc định) — danh mục nhiều người cùng sửa, đúng tinh thần #209 "xử lý xung đột nhiều máy". */

export function useTechnicalServicesQuery(params: TechnicalServiceListParams) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'technical-service', 'list', JSON.stringify(params)),
    queryFn: () => listTechnicalServices(params),
  });
}

export function useTechnicalServiceQuery(id: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'technical-service', 'detail', id ?? undefined),
    queryFn: () => getTechnicalService(id!),
    enabled: id !== null,
  });
}

export function useLabIndicatorsQuery(params: { search?: string; includeInactive?: boolean }) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'lab-indicator', 'list', JSON.stringify(params)),
    queryFn: () => listLabIndicators(params),
  });
}

export function useLabIndicatorQuery(id: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'lab-indicator', 'detail', id ?? undefined),
    queryFn: () => getLabIndicator(id!),
    enabled: id !== null,
  });
}

export function useResultTemplatesQuery(params: { technicalServiceId?: string; includeInactive?: boolean }) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'result-template', 'list', JSON.stringify(params)),
    queryFn: () => listResultTemplates(params),
  });
}

function useInvalidate(domain: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, domain) });
}

export function useCreateTechnicalServiceMutation() {
  const invalidate = useInvalidate('technical-service');
  return useMutation({ mutationFn: (body: CreateTechnicalServiceRequest) => createTechnicalService(body), onSuccess: invalidate });
}

export function useUpdateTechnicalServiceMutation() {
  // Chỉ số của dịch vụ đổi → đếm "dùng trong N dịch vụ" ở danh sách chỉ số cũng phải mới.
  const invalidate = useInvalidate('technical-service');
  const invalidateIndicators = useInvalidate('lab-indicator');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateTechnicalServiceRequest }) => updateTechnicalService(id, body),
    onSuccess: () => {
      invalidate();
      invalidateIndicators();
    },
  });
}

export function useCreateLabIndicatorMutation() {
  const invalidate = useInvalidate('lab-indicator');
  return useMutation({ mutationFn: (body: CreateLabIndicatorRequest) => createLabIndicator(body), onSuccess: invalidate });
}

export function useUpdateLabIndicatorMutation() {
  const invalidate = useInvalidate('lab-indicator');
  const invalidateServices = useInvalidate('technical-service');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLabIndicatorRequest }) => updateLabIndicator(id, body),
    onSuccess: () => {
      invalidate();
      invalidateServices();
    },
  });
}

export function useCreateResultTemplateMutation() {
  const invalidate = useInvalidate('result-template');
  return useMutation({ mutationFn: (body: CreateResultTemplateRequest) => createResultTemplate(body), onSuccess: invalidate });
}

export function useUpdateResultTemplateMutation() {
  const invalidate = useInvalidate('result-template');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateResultTemplateRequest }) => updateResultTemplate(id, body),
    onSuccess: invalidate,
  });
}
