import { useEffect, useRef } from 'react';

/**
 * Gọi `retry` ngay khi trình duyệt bắn sự kiện `online`, CỘNG thêm gọi lặp lại mỗi `intervalMs`
 * trong lúc `active=true` — dự phòng trường hợp sự kiện `online`/`navigator.onLine` báo sai (một
 * số mạng captive portal/proxy trả kết nối "có vẻ ổn" trước khi thật sự có Internet). Dùng cho
 * ENC-06 (lưu nháp offline màn khám) — chỗ dùng đầu tiên, viết ở `shared/hooks` với chủ đích tái
 * dùng ngay vì mẫu retry-khi-có-mạng này sẽ còn cần cho tính năng offline khác sau này.
 */
export function useOnlineRetry(active: boolean, retry: () => void, intervalMs = 15_000): void {
  const retryRef = useRef(retry);
  retryRef.current = retry;

  useEffect(() => {
    if (!active) return;
    function handleOnline() {
      retryRef.current();
    }
    window.addEventListener('online', handleOnline);
    const interval = setInterval(() => retryRef.current(), intervalMs);
    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [active, intervalMs]);
}
