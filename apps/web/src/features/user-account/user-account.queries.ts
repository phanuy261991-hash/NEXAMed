import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserAccountRequest, ResetUserPasswordRequest, UpdateOwnProfileRequest, UpdateUserAccountRequest } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createUserAccount,
  getMyProfile,
  listUserAccounts,
  resetUserPassword,
  updateMyProfile,
  updateUserAccount,
  uploadUserAccountSignature,
} from './user-account.api';

/**
 * Quy mô nhân sự một phòng khám 1-3 bác sĩ rất nhỏ (khác bệnh nhân, mục tiêu 50.000 hồ sơ) — lấy
 * 1 trang lớn (limit tối đa backend cho phép), không cần cuộn vô hạn/virtualization như
 * `PatientListPage` (`.claude/docs/ui-guidelines.md` mục 9 — lý do bắt buộc virtualization không
 * áp dụng ở đây).
 */
export function useUserAccountsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'users'),
    queryFn: () => listUserAccounts({ limit: 100 }),
  });
}

function useInvalidateUserAccounts() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'users') });
  };
}

export function useCreateUserAccountMutation() {
  const invalidate = useInvalidateUserAccounts();
  return useMutation({
    mutationFn: (body: CreateUserAccountRequest) => createUserAccount(body),
    onSuccess: invalidate,
  });
}

export function useUpdateUserAccountMutation() {
  const invalidate = useInvalidateUserAccounts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateUserAccountRequest }) => updateUserAccount(id, body),
    onSuccess: invalidate,
  });
}

export function useResetUserPasswordMutation() {
  const invalidate = useInvalidateUserAccounts();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ResetUserPasswordRequest }) => resetUserPassword(id, body),
    onSuccess: invalidate,
  });
}

/** Ảnh chữ ký (redesign 3-tab, #082) — cùng mẫu `useUploadPatientPhotoMutation`. */
export function useUploadUserAccountSignatureMutation() {
  const invalidate = useInvalidateUserAccounts();
  return useMutation({
    mutationFn: ({ id, file, version }: { id: string; file: File; version: number }) => uploadUserAccountSignature(id, file, version),
    onSuccess: invalidate,
  });
}

/** Menu avatar "Thông tin tài khoản" (`MyAccountDialog.tsx`) — hồ sơ của chính mình, mọi vai trò dùng được. */
export function useMyProfileQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'users', 'me'),
    queryFn: getMyProfile,
    enabled,
  });
}

export function useUpdateMyProfileMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOwnProfileRequest) => updateMyProfile(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, 'users', 'me') });
    },
  });
}
