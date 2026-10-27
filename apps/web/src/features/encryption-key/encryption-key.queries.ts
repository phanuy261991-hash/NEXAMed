import { useQuery } from '@tanstack/react-query';
import type { EncryptionKeyStatusResponse } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { getApiClient, unwrap } from '../../shared/api/client';
import { queryKey } from '../../shared/api/query-keys';

async function getEncryptionKeyStatus(): Promise<EncryptionKeyStatusResponse> {
  return unwrap(await getApiClient().GET('/api/v1/encryption-key/status')) as EncryptionKeyStatusResponse;
}

/**
 * Khoá mã hoá hệ thống có khớp dữ liệu không (docs/DECISIONS.md #262). Mọi tài khoản đã đăng nhập gọi được; 10 phút/lần là đủ (khoá chỉ đổi khi khởi động lại máy chủ). Lỗi tải KHÔNG hiện gì:
 * đây là cảnh báo bổ sung, không phải dữ liệu của trang — trang vẫn dùng bình thường và chính các trường mã hoá đã tự hiện "Không đọc được".
 */
export function useEncryptionKeyStatusQuery(enabled = true) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'encryption-key', 'status'),
    queryFn: getEncryptionKeyStatus,
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    retry: false,
  });
}
