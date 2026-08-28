import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AmendClinicalNoteRequest,
  AmendDiagnosesRequest,
  AmendPrescriptionRequest,
  CompleteConsultationRequest,
  RecordVitalSignRequest,
  SaveClinicalNoteRequest,
  SaveDiagnosesRequest,
  SavePrescriptionItemsRequest,
  SignPrescriptionRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  amendClinicalNote,
  amendDiagnoses,
  amendPrescription,
  completeConsultation,
  getConsultationDetail,
  printPrescription,
  recordVitalSigns,
  saveClinicalNote,
  saveDiagnoses,
  savePrescriptionItems,
  signPrescription,
} from './encounter.api';

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

/** "Đính chính chẩn đoán" (Sprint 5, S5-02/03) — chỉ khi đã ký. */
export function useAmendDiagnosesMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: AmendDiagnosesRequest) => amendDiagnoses(id, body),
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

/** "Đính chính ghi chú khám" (Sprint 5, S5-02/03) — chỉ sửa đúng section đổi nội dung. */
export function useAmendClinicalNoteMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: AmendClinicalNoteRequest) => amendClinicalNote(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** Kê đơn (Sprint 4, S4-01/02) — thay TOÀN BỘ dòng thuốc của đơn nháp hiện tại. */
export function useSavePrescriptionItemsMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SavePrescriptionItemsRequest) => savePrescriptionItems(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** Ký đơn thuốc — sau khi ký đơn bất biến (trigger C8), sửa = "Sửa đơn" (amend). */
export function useSignPrescriptionMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SignPrescriptionRequest) => signPrescription(id, body),
    onSuccess: () => void invalidate(),
  });
}

/** In đơn (PRE-04) — ghi nhận `printedAt`, idempotent. */
export function usePrintPrescriptionMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: () => printPrescription(id),
    onSuccess: () => void invalidate(),
  });
}

/** "Sửa đơn" — đính chính đơn đã ký. */
export function useAmendPrescriptionMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: AmendPrescriptionRequest) => amendPrescription(id, body),
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