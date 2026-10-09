import { useCallback, useState } from 'react';

/**
 * Cột TUỲ CHỌN hiển thị của một bảng, nhớ theo `storageKey` trên máy người dùng (localStorage — chỉ là tiện ích cá nhân, không thuộc dữ liệu nghiệp vụ). Dùng chung với
 * `ColumnVisibilityMenu` (`shared/ui`). `allKeys` là toàn bộ cột tuỳ chọn mà bảng đang cho phép (đã lọc theo quyền); khoá lạ đã lưu từ phiên bản cũ bị bỏ qua. Chưa lưu gì thì
 * dùng `defaultVisible` (mặc định bật hết). Đọc/ghi localStorage luôn bọc try/catch — cửa sổ ẩn danh, bị chặn dữ liệu trang vẫn chạy bình thường.
 */
export function useColumnVisibility(storageKey: string, allKeys: readonly string[], defaultVisible: readonly string[] = allKeys) {
  const [stored, setStored] = useState<string[] | null>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : null;
    } catch {
      return null;
    }
  });

  const currentKeys = () => (stored ?? defaultVisible).filter((k) => allKeys.includes(k));
  const visible = new Set(currentKeys());

  const persist = useCallback(
    (next: string[]) => {
      setStored(next);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* không lưu được thì chỉ mất ghi nhớ giữa các lần mở */
      }
    },
    [storageKey],
  );

  function toggle(key: string) {
    const next = new Set(currentKeys());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persist([...next]);
  }

  function showAll() {
    persist([...allKeys]);
  }

  return { visible, toggle, showAll };
}
