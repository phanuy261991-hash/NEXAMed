import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getSystemVersion } from './system.api';

const ONE_MINUTE_MS = 60_000;
const FIVE_MINUTES_MS = 5 * 60_000;

/**
 * Phiên bản máy chủ (docs/DECISIONS.md #236) — hỏi lại mỗi 5 phút và khi người dùng quay lại tab sau hơn 1 phút, để phát hiện "máy chủ vừa được cập nhật mà trình duyệt còn giữ gói web cũ"
 * (`VersionMismatchBanner`) và để hộp "Giới thiệu" luôn hiện đúng bản đang chạy.
 */
export function useSystemVersionQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'system', 'version'),
    queryFn: getSystemVersion,
    staleTime: ONE_MINUTE_MS,
    refetchInterval: FIVE_MINUTES_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
