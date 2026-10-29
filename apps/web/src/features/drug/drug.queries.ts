import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDrugRequest, DrugItemType, UpdateDrugRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { commitDrugImport, createDrug, getDrug, listDrugs, updateDrug } from './drug.api';

/** Dữ liệu do `clinic_admin` sửa qua UI quản lý — không `staleTime: Infinity`, invalidate sau mỗi mutation. */
export function useDrugsQuery(params: { q?: string; itemType?: DrugItemType; includeInactive?: boolean; prescriptionOnly?: boolean } = {}) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(
      tenantId,
      'drug',
      params.q ?? '',
      params.itemType ?? 'ANY',
      params.includeInactive ? 'all' : 'active',
      params.prescriptionOnly === undefined ? 'any' : String(params.prescriptionOnly),
    ),
    queryFn: () => listDrugs({ q: params.q, itemType: params.itemType, includeInactive: params.includeInactive ?? false, prescriptionOnly: params.prescriptionOnly }),
  });
}

/** Chi tiết MỘT thuốc (kèm cấu hình "Cách kê liều") — dòng kê đơn đọc đơn vị liều, dung tích và liều mẫu từ đây (#267). `null` (dòng kê tự do) thì không gọi. */
export function useDrugQuery(drugId: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'drug', 'detail', drugId ?? ''),
    queryFn: () => getDrug(drugId!),
    enabled: drugId !== null,
    // Cấu hình thuốc hiếm đổi giữa buổi khám — giữ cache vài phút để mỗi dòng đơn không gọi lại.
    staleTime: 5 * 60_000,
  });
}

function useInvalidateDrugs() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'drug') });
}

export function useCreateDrugMutation() {
  const invalidate = useInvalidateDrugs();
  return useMutation({ mutationFn: (body: CreateDrugRequest) => createDrug(body), onSuccess: invalidate });
}

export function useUpdateDrugMutation() {
  const invalidate = useInvalidateDrugs();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateDrugRequest }) => updateDrug(id, body),
    onSuccess: invalidate,
  });
}

/** Commit nhập Excel — làm mới danh sách thuốc VÀ mọi danh mục dùng chung (có thể vừa tạo mới Đơn vị/Hãng/Hoạt chất...). */
export function useCommitDrugImportMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => commitDrugImport(file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'drug') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reference-catalog') });
    },
  });
}
