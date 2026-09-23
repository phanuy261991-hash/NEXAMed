import { useCallback, useState } from 'react';

/**
 * Trạng thái thu gọn/xổ ra cho các nhóm dòng trong bảng "1 tiêu đề sản phẩm + N dòng lô"
 * (`StockCountFormPage.tsx`/`StockReceiptFormPage.tsx`) — mặc định MỌI nhóm xổ ra (tập rỗng),
 * bấm nhóm nào thì nhóm đó thu lại, tránh chiếm quá nhiều chỗ khi 1 mặt hàng có nhiều lô (chủ dự
 * án yêu cầu trực tiếp 23/09/2026). Đặt ở `shared/hooks` với chủ đích tái dùng ngay — cùng nhu cầu
 * ở ít nhất 2 nơi khi viết hook này.
 */
export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return { isCollapsed, toggle };
}
