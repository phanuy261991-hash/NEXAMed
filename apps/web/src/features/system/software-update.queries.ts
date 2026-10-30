import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { useHasPermission } from '../auth/usePermission';
import { checkSoftwareUpdate, getReleaseNotesHistory, getSoftwareUpdateStatus } from './software-update.api';
import { useSystemVersionQuery } from './system.queries';

const FIVE_MINUTES_MS = 5 * 60_000;

/**
 * Trang "Cập nhật phần mềm" có hiển thị cho tài khoản này không: có quyền `software_update.read` VÀ hệ thống phục vụ một công ty (ở chế độ SaaS máy chủ trả 404 cho mọi đường dẫn cập nhật).
 * Chế độ triển khai lấy từ `GET /system/version` (công khai) — chưa tải xong thì coi là chưa hiện, tránh gọi API rồi nhận 404.
 */
export function useSoftwareUpdateVisible(): boolean {
  const canRead = useHasPermission('software_update', 'read');
  const versionQuery = useSystemVersionQuery();
  return canRead && versionQuery.data?.deploymentMode === 'single';
}

/** `enabled` bắt buộc truyền vào (xem `useSoftwareUpdateVisible`) — tránh gửi request 403/404 cho tài khoản không thấy trang này. Máy chủ tự kiểm bản mới định kỳ, web chỉ đọc kết quả gần nhất. */
export function useSoftwareUpdateStatusQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'system', 'software-update'),
    queryFn: getSoftwareUpdateStatus,
    enabled,
    staleTime: FIVE_MINUTES_MS,
    refetchInterval: FIVE_MINUTES_MS * 6,
    retry: 1,
  });
}

/** Ghi chú phát hành đóng kèm (bản đang chạy + các bản trước). Đổi theo từng lần phát hành chứ không theo thời gian nên giữ đệm lâu. */
export function useReleaseNotesHistoryQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'system', 'release-notes'),
    queryFn: getReleaseNotesHistory,
    enabled,
    staleTime: 60 * 60_000,
    retry: 1,
  });
}

/** Chấm xanh ở avatar + nhãn "Mới" trong menu người dùng — chỉ tài khoản thấy trang cập nhật mới được báo. */
export function useUpdateAvailable(): boolean {
  const visible = useSoftwareUpdateVisible();
  const query = useSoftwareUpdateStatusQuery(visible);
  return visible && query.data?.state === 'update_available';
}

export function useCheckSoftwareUpdateMutation() {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: checkSoftwareUpdate,
    onSuccess: (status) => {
      queryClient.setQueryData(queryKey(tenantId, 'system', 'software-update'), status);
    },
  });
}
