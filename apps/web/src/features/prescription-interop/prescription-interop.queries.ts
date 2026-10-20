import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListInteropSubmissionsQuery, SaveEncounterInteropInfoRequest, SaveInteropCredentialRequest, UpdatePrescriptionInteropSettingsRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  addInteropDoctorToFacility,
  getEncounterInteropInfo,
  getPrescriptionInteropSettings,
  getPrescriptionInteropStatus,
  listInteropDoctors,
  listInteropFacilities,
  listInteropSubmissions,
  loginInteropFacility,
  removeInteropDoctorFromFacility,
  retryInteropSubmission,
  saveEncounterInteropInfo,
  saveInteropDoctorCredential,
  saveInteropFacilityCredential,
  sendInteropSubmission,
  updatePrescriptionInteropSettings,
} from './prescription-interop.api';

/** Công tắc tổng — màn kê đơn/menu dùng để hiện hay ẩn mọi phần liên thông (tự-phục vụ, không cần quyền cấu hình). */
export function usePrescriptionInteropStatusQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'prescription-interop', 'status'), queryFn: getPrescriptionInteropStatus, enabled });
}

export function usePrescriptionInteropSettingsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'prescription-interop', 'settings'), queryFn: getPrescriptionInteropSettings });
}

export function useUpdatePrescriptionInteropSettingsMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePrescriptionInteropSettingsRequest) => updatePrescriptionInteropSettings(body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop') }),
  });
}

/** Chỉ tải khi công tắc tổng đang BẬT (tắt thì không có phần nào hiện nên khỏi gọi). */
export function useInteropFacilitiesQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'prescription-interop', 'facilities'), queryFn: listInteropFacilities, enabled });
}

export function useInteropDoctorsQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'prescription-interop', 'doctors'), queryFn: listInteropDoctors, enabled });
}

export function useSaveInteropFacilityCredentialMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ branchId, body }: { branchId: string; body: SaveInteropCredentialRequest }) => saveInteropFacilityCredential(branchId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'facilities') }),
  });
}

export function useSaveInteropDoctorCredentialMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: SaveInteropCredentialRequest }) => saveInteropDoctorCredential(userId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'doctors') }),
  });
}

/** Thao tác gọi cổng đổi token/"Trên cổng" nên làm mới cả hai danh sách. */
function useInteropGatewayMutation<TVars>(fn: (vars: TVars) => Promise<import('@nexamed/shared').InteropActionResult>) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'facilities') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'doctors') });
    },
  });
}

export function useLoginInteropFacilityMutation() {
  return useInteropGatewayMutation((branchId: string) => loginInteropFacility(branchId));
}

export function useAddInteropDoctorMutation() {
  return useInteropGatewayMutation((userId: string) => addInteropDoctorToFacility(userId));
}

export function useRemoveInteropDoctorMutation() {
  return useInteropGatewayMutation((userId: string) => removeInteropDoctorFromFacility(userId));
}

// ---- Ô bổ sung bắt buộc khi gửi đơn + dải kiểm dữ liệu (mockup 8a/8b) ----

/**
 * Thông tin liên thông của một lượt khám. `prescriptionVersion` nằm trong khoá cache: ký/đính chính/lưu nháp đổi phiên bản đơn nên dải kiểm 8a tự tải lại, không phải nhớ
 * làm mới ở từng nơi. Chỉ tải khi công tắc tổng bật và đã có đơn.
 */
export function useEncounterInteropInfoQuery(encounterId: string, prescriptionVersion: number | null, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'encounter', 'interop-info', encounterId, String(prescriptionVersion)),
    queryFn: () => getEncounterInteropInfo(encounterId),
    enabled,
    retry: false,
  });
}

export function useSaveEncounterInteropInfoMutation(encounterId: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveEncounterInteropInfoRequest) => saveEncounterInteropInfo(encounterId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'encounter', 'interop-info', encounterId) });
      // Hồ sơ bệnh nhân (người giám hộ) và hàng chờ gửi cũng đổi theo.
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'submissions') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'patient') });
    },
  });
}

// ---- Hàng chờ gửi (mockup 8c) ----

export function useInteropSubmissionsQuery(query: ListInteropSubmissionsQuery, enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'prescription-interop', 'submissions', JSON.stringify(query)),
    queryFn: () => listInteropSubmissions(query),
    enabled,
    // Bộ gửi nền đổi trạng thái mỗi phút — làm mới nhẹ khi đang mở trang.
    refetchInterval: 30_000,
  });
}

function useInteropSubmissionActionMutation(fn: (id: string) => Promise<import('@nexamed/shared').InteropSubmissionActionResponse>) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'prescription-interop', 'submissions') });
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'encounter', 'interop-info') });
    },
  });
}

export function useSendInteropSubmissionMutation() {
  return useInteropSubmissionActionMutation(sendInteropSubmission);
}

export function useRetryInteropSubmissionMutation() {
  return useInteropSubmissionActionMutation(retryInteropSubmission);
}
