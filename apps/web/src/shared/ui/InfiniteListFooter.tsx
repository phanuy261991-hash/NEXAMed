import type { ReactNode } from 'react';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

/**
 * Phần cuối của danh sách tải THEO LÔ khi cuộn (docs/DECISIONS.md #251, mockup đã duyệt https://claude.ai/artifact/7UcUL7EkvP5jV7KjR3k15b). Hai mảnh, đặt ở hai chỗ khác nhau:
 *  - `InfiniteScrollTail` — BÊN TRONG vùng cuộn, ngay sau dòng cuối: phần tử "mốc" để quan sát + vài dòng khung xương khi đang tải lô kế tiếp.
 *  - `InfiniteListFooter` — thanh cố định DƯỚI bảng: trạng thái (đang tải / lỗi kèm "Thử lại" / đã hết) và "Đang hiển thị X / Y dòng".
 * Không biết gì về nghiệp vụ từng màn — nhận số liệu qua props để Danh sách tiếp nhận, Thu ngân và các danh sách sau này dùng chung.
 */
export function InfiniteScrollTail({
  sentinelRef,
  hasNextPage,
  isFetchingNextPage,
  skeletonRows = 2,
}: {
  sentinelRef: (el: HTMLElement | null) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  skeletonRows?: number;
}) {
  if (!hasNextPage) return null;
  return (
    <>
      {isFetchingNextPage && (
        <div className="space-y-3 px-4 py-3" aria-hidden="true">
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
    </>
  );
}

export function InfiniteListFooter({
  loaded,
  total,
  hasNextPage,
  isFetchingNextPage,
  isLoadMoreError,
  onRetry,
}: {
  loaded: number;
  /** Tổng số dòng khớp bộ lọc hiện tại (của CẢ NGÀY, lấy từ máy chủ) — không phải số dòng đã tải. */
  total: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  /** Lô kế tiếp tải lỗi — các dòng đã có vẫn giữ nguyên. */
  isLoadMoreError: boolean;
  onRetry: () => void;
}) {
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  let status: ReactNode;
  if (isLoadMoreError) {
    status = (
      <span role="alert" className="font-semibold text-rose-700">
        Không tải thêm được. Các dòng đã có vẫn giữ nguyên.
      </span>
    );
  } else if (isFetchingNextPage) {
    status = (
      <span role="status" className="flex items-center gap-2">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" aria-hidden="true" />
        Đang tải thêm…
      </span>
    );
  } else if (!hasNextPage && total > 0) {
    status = <span>Đã hiển thị hết</span>;
  } else {
    status = <span />;
  }

  return (
    <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
      {status}
      <span className="flex items-center gap-3">
        {isLoadMoreError && (
          <Button type="button" variant="danger" onClick={onRetry} className="px-2.5 py-0.5 text-xs">
            Thử lại
          </Button>
        )}
        <span className="tabular-nums">
          Đang hiển thị <b className="font-semibold text-slate-900">{fmt(loaded)}</b> / <b className="font-semibold text-slate-900">{fmt(total)}</b> dòng
        </span>
      </span>
    </div>
  );
}
