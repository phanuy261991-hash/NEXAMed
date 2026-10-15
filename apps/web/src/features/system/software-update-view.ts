import type { UpdateCheckHistoryItem } from '@nexamed/shared';

/** Một dòng "Kết quả" ở bảng "Lịch sử kiểm tra gần đây" — chữ cho người dùng, không lộ mã nội bộ. */
export function formatHistoryResult(item: Pick<UpdateCheckHistoryItem, 'result' | 'latestVersion'>): string {
  if (item.result === 'update_available') return item.latestVersion ? `Có bản ${item.latestVersion}` : 'Có bản mới';
  if (item.result === 'error') return 'Lỗi kết nối';
  return 'Đang là bản mới nhất';
}
