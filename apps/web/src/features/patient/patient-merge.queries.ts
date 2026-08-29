import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { MergePatientsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { mergePatients } from './patient-merge.api';

/**
 * S5-06, PAT-04 — vô hiệu hoá danh sách bệnh nhân + chi tiết CẢ HAI hồ sơ (nguồn/đích) sau khi
 * gộp, vì cả hai đều đổi (`mergedIntoId` ở nguồn, không có gì đổi ở đích ngoài số lượt khám —
 * nhưng client không biết trước lượt khám đó có đang mở ở đâu, invalidate cho chắc).
 */
export function useMergePatientsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MergePatientsRequest) => mergePatients(body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient', 'list') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient', 'detail', result.sourceId) });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient', 'detail', result.targetId) });
    },
  });
}
