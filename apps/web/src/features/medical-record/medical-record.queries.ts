import { useMutation, useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { exportEncounterMedicalRecord, getMedicalRecordParaclinical } from './medical-record.api';

/** Kết quả cận lâm sàng đã duyệt của lượt khám đang xem. Bản ghi đã ký ít đổi nên giữ cache 60 giây; không tự thử lại khi lỗi quyền/không tìm thấy. */
export function useMedicalRecordParaclinicalQuery(encounterId: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'encounter', 'medical-record-paraclinical', encounterId),
    queryFn: () => getMedicalRecordParaclinical(encounterId),
    staleTime: 60_000,
    retry: false,
  });
}

/** "In bộ hồ sơ" / "Xuất PDF" một lượt khám. Không ghi cache nào (chỉ phát sinh tệp), nên không có `onSuccess` làm mới dữ liệu. */
export function useExportEncounterMedicalRecordMutation(encounterId: string) {
  return useMutation({
    mutationFn: (input: { reason: string; target: Parameters<typeof exportEncounterMedicalRecord>[2] }) => exportEncounterMedicalRecord(encounterId, input.reason, input.target),
  });
}
