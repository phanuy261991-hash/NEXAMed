import { Skeleton } from './Skeleton';

/**
 * Fallback cho `<Suspense>` bọc các route tải theo nhu cầu (code-splitting, `app/router.tsx` —
 * xem `.claude/docs/coding-standards.md` mục Hiệu suất). Chỉ hiện trong khoảnh khắc tải chunk
 * JS của trang (mạng LAN on-prem thường vài chục ms), KHÔNG phải trạng thái chờ dữ liệu API —
 * mỗi trang tự lo skeleton riêng khớp hình dáng dữ liệu của nó (`ui-guidelines.md` mục 3).
 *
 * Vì vậy cố ý giữ trung tính (vài thanh xám) thay vì bắt chước bố cục một màn hình cụ thể: cùng
 * một fallback dùng cho mọi route lazy, nếu vẽ theo hình dáng bảng danh sách thì sẽ sai hẳn khi
 * chuyển sang route dạng form.
 */
export function PageFallback() {
  return (
    <div className="space-y-3 p-6" role="status" aria-label="Đang tải trang">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-5 w-full max-w-2xl" />
      <Skeleton className="h-5 w-full max-w-xl" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}