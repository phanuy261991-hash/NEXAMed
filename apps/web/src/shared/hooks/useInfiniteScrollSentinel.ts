import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tự tải lô kế tiếp khi người dùng cuộn gần cuối danh sách (docs/DECISIONS.md #251) — gắn `sentinelRef` vào một phần tử rỗng đặt SAU dòng cuối trong vùng cuộn của bảng.
 * `onReach` chạy khi phần tử đó lọt vào vùng nhìn (cộng `rootMargin`: mặc định tải trước khoảng 8 dòng). `enabled=false` (hết dữ liệu / đang tải / lỗi) thì không quan sát.
 *
 * `watchKey` PHẢI đổi mỗi khi số dòng đã tải đổi: nếu sau khi tải xong mà phần tử vẫn nằm trong vùng nhìn (bảng ngắn hơn màn hình) thì IntersectionObserver không báo lại,
 * danh sách sẽ đứng ở lô đầu — đổi `watchKey` buộc quan sát lại và nhận ngay trạng thái hiện tại. Môi trường không có IntersectionObserver (test) thì không làm gì.
 */
export function useInfiniteScrollSentinel({
  enabled,
  onReach,
  watchKey,
  rootMargin = '0px 0px 480px 0px',
}: {
  enabled: boolean;
  onReach: () => void;
  watchKey: unknown;
  rootMargin?: string;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;

  const sentinelRef = useCallback((el: HTMLElement | null) => setNode(el), []);

  useEffect(() => {
    if (!enabled || !node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onReachRef.current();
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, node, rootMargin, watchKey]);

  return sentinelRef;
}
