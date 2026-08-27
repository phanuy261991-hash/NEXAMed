import { useCallback, useMemo, useState } from 'react';

/**
 * State chọn dòng dùng chung cho mọi bảng danh sách — để sẵn cho chức năng hành động hàng loạt
 * sau này (chưa chốt hành động cụ thể nào, xem CancelEncounterDialog/#085 không liên quan).
 *
 * "Chọn tất cả" chỉ tác động các dòng ĐÃ TẢI (`loadedIds` — trang hiện tại hoặc toàn bộ dòng đã
 * tải qua cuộn vô hạn), không gọi API để chọn hết mọi bản ghi khớp bộ lọc trên server.
 */
export function useRowSelection(loadedIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectedLoadedCount = useMemo(() => loadedIds.filter((id) => selectedIds.has(id)).length, [loadedIds, selectedIds]);
  const allLoadedSelected = loadedIds.length > 0 && selectedLoadedCount === loadedIds.length;
  const someLoadedSelected = selectedLoadedCount > 0 && !allLoadedSelected;

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = loadedIds.length > 0 && loadedIds.every((id) => next.has(id));
      for (const id of loadedIds) {
        if (allSelected) {
          next.delete(id);
        } else {
          next.add(id);
        }
      }
      return next;
    });
  }, [loadedIds]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return {
    selectedIds,
    selectedCount: selectedIds.size,
    isSelected: (id: string) => selectedIds.has(id),
    toggle,
    toggleAll,
    allLoadedSelected,
    someLoadedSelected,
    clear,
  };
}