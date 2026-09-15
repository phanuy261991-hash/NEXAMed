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

/**
 * `networkMode: 'always'` (ENC-06) — mặc định TanStack Query v5 (`'online'`) sẽ TẠM DỪNG mutation
 * (không gọi `mutationFn`, không throw, không resolve) khi `navigator.onLine === false`, tự chạy
 * lại khi có mạng — bug thật phát hiện lúc test Playwright: `mutateAsync()` treo VÔ THỜI HẠN lúc
 * offline thay vì reject nhanh (fetch thật chỉ mất ~30ms để fail khi mất mạng, đã xác nhận bằng
 * script riêng), khiến `catch` trong `EncounterConsultationPage.tsx` không bao giờ chạy tới — mất
 * hẳn banner "Mất mạng" hiển thị TRỰC TIẾP lúc còn mở trang (chỉ còn cứu được nhờ `beforeunload`
 * lúc đóng tab, không phải cơ chế chính). Bắt buộc GỌI THẬT ngay cả khi offline để `catch` bắt được
 * lỗi mạng thật và lưu nháp ngay lập tức — đúng tinh thần ENC-06. */
export function useSaveDiagnosesMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SaveDiagnosesRequest) => saveDiagnoses(id, body),
    onSuccess: () => void invalidate(),
    networkMode: 'always',
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

/** `networkMode: 'always'` — xem docstring `useSaveDiagnosesMutation` ở trên (cùng lý do, cùng
 * tính năng ENC-06, endpoint này là nơi autosave chính chạy mỗi 4 giây). */
export function useSaveClinicalNoteMutation(id: string) {
  const invalidate = useInvalidateConsultation(id);
  return useMutation({
    mutationFn: (body: SaveClinicalNoteRequest) => saveClinicalNote(id, body),
    onSuccess: () => void invalidate(),
    networkMode: 'always',
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