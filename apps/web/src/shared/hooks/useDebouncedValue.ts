import { useEffect, useState } from 'react';

/**
 * Trễ một giá trị theo `delayMs` — dùng cho ô tìm kiếm gọi API (PAT-02 và các màn hình tìm kiếm
 * khác sau này) để không gọi API theo từng ký tự gõ. Đặt ở `shared/hooks` với chủ đích tái dùng
 * ngay từ lần viết đầu tiên (.claude/docs/coding-standards.md).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
