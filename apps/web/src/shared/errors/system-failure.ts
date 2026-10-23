import { ApiError } from '../api/client';

/**
 * Lỗi HỆ THỐNG khi đang thực hiện một thao tác (docs/DECISIONS.md #255): mất mạng, máy chủ chưa bật/đang khởi động, máy chủ lỗi 5xx. Với các lỗi
 * này giao diện hiện MỘT HỘP thông báo đè lên trang, giữ nguyên dữ liệu người dùng đang nhập. Lỗi NGHIỆP VỤ/kiểm tra hợp lệ (4xx, ví dụ "Phiếu
 * thu đã được thanh toán") KHÔNG thuộc nhóm này: vẫn hiện tại chỗ phát sinh như quy ước ở ui-guidelines mục 4.3, để người dùng sửa ngay.
 *
 * - `network`: không tới được máy chủ (mất mạng, DNS, CORS, hết thời gian chờ).
 * - `unavailable`: 502/503/504 — hệ thống đang khởi động hoặc proxy không nối được tới máy chủ ứng dụng.
 * - `server`: các lỗi 5xx còn lại.
 */
export type SystemFailureKind = 'network' | 'unavailable' | 'server';

function isNetworkLike(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'NetworkError';
  }
  // `fetch` thất bại trước khi có phản hồi: Chrome "Failed to fetch", Firefox "NetworkError when attempting to fetch resource", Safari "Load failed".
  return error instanceof TypeError && /failed to fetch|networkerror|load failed|network request failed/i.test(error.message);
}

/** `null` = KHÔNG phải lỗi hệ thống (để nơi gọi tự hiện tại chỗ như cũ). Lỗi lập trình/lỗi lạ cũng trả `null` — màn lỗi toàn cục lo phần hiển thị. */
export function classifySystemFailure(error: unknown): SystemFailureKind | null {
  if (error instanceof ApiError) {
    const status = error.status;
    if (status === 502 || status === 503 || status === 504) return 'unavailable';
    if (status !== undefined && status >= 500) return 'server';
    return null;
  }
  return isNetworkLike(error) ? 'network' : null;
}
