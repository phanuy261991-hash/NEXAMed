import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompleteConsultationRequest, RecordVitalSignRequest, SaveClinicalNoteRequest, SaveDiagnosesRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { completeConsultation, getConsultationDetail, recordVitalSigns, saveClinicalNote, saveDiagnoses } from './encounter.api';

export function useConsultationDetailQuery(id: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'encounter', 'consultation', id),
    queryFn: () => getConsultationDetail(id),
  });
}

function useInvalidateConsultation(id: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'encounter', 'consultation', id) });
}

export function useSaveDiagnosesMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SaveDiagnosesRequest) => saveDiagnoses(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** Bổ sung/đo lại sinh hiệu ngay trong màn khám (REC-02/03) — dùng khi lễ tân chưa nhập lúc tiếp nhận hoặc cần cập nhật lần đo mới. */
export function useRecordVitalSignsMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: RecordVitalSignRequest) => recordVitalSigns(id, body),
    onSuccess: () => void invalidate(),
  });
}

export function useSaveClinicalNoteMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SaveClinicalNoteRequest) => saveClinicalNote(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** Sau khi hoàn tất, dòng này biến mất khỏi "Hàng đợi khám" — invalidate cả domain 'reception' (cùng nguồn dữ liệu, xem reception.queries.ts). */
export function useCompleteConsultationMutation(id: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CompleteConsultationRequest) => completeConsultation(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'encounter') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'reception') });
    },
  });
}