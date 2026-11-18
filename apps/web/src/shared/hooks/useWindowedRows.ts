import { useRef, type CSSProperties } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

/**
 * Cuộn ảo cho bảng dạng lưới (`role="row"` + `grid`): chỉ dựng các hàng đang nhìn thấy (cộng vài hàng đệm), không dựng cả nghìn hàng một lần.
 * Đo 17/11/2026 (docs/DECISIONS.md #303): `/inventory/dispense` dựng 1.919 hàng (8.821 phần tử DOM) làm luồng chính bị chặn ~260 ms trên máy thường và ~1 giây trên máy văn phòng cũ.
 * Khác `PatientListPage` (cột cố định + tải thêm theo trang từ máy chủ): hook này dành cho danh sách ĐÃ có đủ dữ liệu ở máy khách, chỉ cần giảm chi phí dựng.
 *
 * Cách dùng: gắn `scrollRef` vào khung cuộn dọc, bọc các hàng trong một thẻ có `containerStyle`, mỗi hàng nhận `ref={measureRow}`, `data-index={vr.index}` và
 * `style={{ ...rowStyle(vr.start), ... }}`. Chiều cao hàng được ĐO THẬT (hàng có thể cao hơn ước lượng khi chữ xuống dòng).
 */
export function useWindowedRows(count: number, estimateRowHeight: number, overscan = 10) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan,
  });
  const containerStyle: CSSProperties = { height: virtualizer.getTotalSize(), position: 'relative', width: '100%' };
  const rowStyle = (start: number): CSSProperties => ({ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${start}px)` });
  return { scrollRef, rows: virtualizer.getVirtualItems(), containerStyle, rowStyle, measureRow: virtualizer.measureElement };
}
