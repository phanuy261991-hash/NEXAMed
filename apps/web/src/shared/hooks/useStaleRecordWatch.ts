import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../api/query-keys';

/** Khoảng kiểm tra bản mới khi form Sửa đang mở (không có WebSocket — cùng pattern polling chuẩn của dự án). */
const WATCH_INTERVAL_MS = 15_000;

/**
 * Phát hiện NGAY LÚC ĐANG MỞ form Sửa rằng người khác đã lưu bản mới của cùng bản ghi (`version` trên
 * server lớn hơn `version` form đang cầm) — thay vì chỉ biết lúc bấm Lưu. Trong lúc `enabled` tự gọi
 * `refetch` mỗi 15 giây (chỉ khi tab đang hiện) và ngay khi cửa sổ được focus lại. Trả `true` khi bản
 * mới hơn bản đang sửa. Dùng khi nơi gọi đã có sẵn truy vấn một bản ghi (ví dụ hồ sơ bệnh nhân);
 * trang quản trị có danh sách dùng `useEditedRecordGuard` bên dưới.
 */
export function useStaleRecordWatch({
  enabled,
  currentVersion,
  latestVersion,
  refetch,
}: {
  enabled: boolean;
  currentVersion: number | undefined;
  latestVersion: number | undefined;
  refetch: () => unknown;
}): boolean {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void refetchRef.current();
    };
    const timer = window.setInterval(tick, WATCH_INTERVAL_MS);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [enabled]);

  return enabled && currentVersion !== undefined && latestVersion !== undefined && latestVersion > currentVersion;
}

/**
 * Gói cho trang quản trị có danh sách + form Sửa: `editing` là bản ghi form đang sửa (hoặc `undefined` khi
 * không sửa). Trong lúc sửa, cứ 15 giây (và khi focus lại cửa sổ) tải CHỈ MỘT bản ghi đó qua
 * `fetchLatest(id)` — 1 request nhẹ, không phụ thuộc bộ lọc hay kích thước danh sách. Trả `stale` (người
 * khác đã lưu bản mới hơn) và `reload()` — tải bản mới nhất rồi gọi `onFresh(bản mới)` để trang mở lại form
 * với dữ liệu mới (`undefined` nếu bản ghi không còn → caller đóng form) và `onReloaded` (thường: làm mới
 * danh sách). `watchKey` phân biệt loại bản ghi trong cache (ví dụ 'supplier').
 */
export function useEditedRecordGuard<T extends { id: string; version: number }>({
  editing,
  watchKey,
  fetchLatest,
  onFresh,
  onReloaded,
}: {
  editing: T | undefined;
  watchKey: string;
  fetchLatest: (id: string) => Promise<T>;
  onFresh: (fresh: T | undefined) => void;
  onReloaded?: () => void;
}) {
  const { tenantId } = useAppConfig();
  const watch = useQuery({
    queryKey: queryKey(tenantId, 'record-watch', watchKey, editing?.id ?? ''),
    queryFn: () => fetchLatest(editing!.id),
    enabled: editing !== undefined,
    refetchInterval: WATCH_INTERVAL_MS, // TanStack Query tự tạm dừng khi tab ẩn và tải lại khi focus cửa sổ
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const stale = editing !== undefined && watch.data !== undefined && watch.data.version > editing.version;

  async function reload() {
    const res = await watch.refetch();
    onFresh(res.data);
    onReloaded?.();
  }
  return { stale, reload };
}
