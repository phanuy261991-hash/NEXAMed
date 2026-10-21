import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateInsuranceCardRequest, InsuranceCardPhotoSide, UpdateInsuranceCardRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createInsuranceCard,
  getInvoiceInsurance,
  listInsuranceCards,
  removeInsuranceCard,
  updateInsuranceCard,
  uploadInsuranceCardPhoto,
} from './insurance-card.api';

/** Thẻ BHYT của một bệnh nhân. `enabled` = công tắc "Áp dụng BHYT" đang bật (tắt thì không gọi API, giao diện đã ẩn). */
export function useInsuranceCardsQuery(patientId: string | undefined, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'insurance-card', patientId),
    queryFn: () => listInsuranceCards(patientId!),
    enabled: enabled && patientId !== undefined,
  });
}

export function useSaveInsuranceCardMutation(patientId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'insurance-card', patientId) });
  return useMutation({
    mutationFn: (input: { cardId: string | null; create?: CreateInsuranceCardRequest; update?: UpdateInsuranceCardRequest }) =>
      input.cardId === null ? createInsuranceCard(patientId, input.create!) : updateInsuranceCard(patientId, input.cardId, input.update!),
    onSuccess: () => void refresh(),
  });
}

export function useRemoveInsuranceCardMutation(patientId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; version: number }) => removeInsuranceCard(patientId, input.cardId, input.version),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'insurance-card', patientId) }),
  });
}

export function useUploadInsuranceCardPhotoMutation(patientId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { cardId: string; side: InsuranceCardPhotoSide; version: number; file: File }) =>
      uploadInsuranceCardPhoto(patientId, input.cardId, input.side, input.version, input.file),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'insurance-card', patientId) }),
  });
}

/** Thẻ đã chụp của lượt khám để IN trên phiếu thu — chỉ gọi khi ô tích "Số thẻ BHYT" của bản mẫu Phiếu thu bật. */
export function useInvoiceInsuranceQuery(encounterId: string | undefined, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'insurance-card', 'invoice', encounterId),
    queryFn: () => getInvoiceInsurance(encounterId!),
    enabled: enabled && encounterId !== undefined,
  });
}
