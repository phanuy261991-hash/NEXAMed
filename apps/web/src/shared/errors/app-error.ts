/**
 * Phân loại lỗi KHÔNG LƯỜNG TRƯỚC để chọn nội dung màn lỗi toàn cục (docs/DECISIONS.md #255 — mọi lỗi phải dẫn về một màn thông báo cụ thể,
 * không lộ mã hay lỗi thô). Logic thuần, không phụ thuộc React để test được ở môi trường node.
 *
 * - `outdated`: không tải được một phần mã của ứng dụng (chunk `lazy`) — gần như luôn là do phần mềm VỪA ĐƯỢC CẬP NHẬT trong lúc trang đang mở,
 *   tên tệp cũ không còn trên máy chủ. Cách xử lý đúng là tải lại trang.
 * - `unreachable`: không kết nối được tới hệ thống lúc khởi động (máy chủ chưa bật, mất mạng, thiếu cấu hình).
 * - `unexpected`: mọi ngoại lệ còn lại khi hiển thị giao diện.
 */
export type AppErrorKind = 'outdated' | 'unexpected' | 'unreachable';

const OUTDATED_PATTERNS: readonly RegExp[] = [
  /dynamically imported module/i, // Chrome/Edge/Firefox: "Failed to fetch dynamically imported module: <url>"
  /importing a module script failed/i, // Safari
  /error loading dynamically imported module/i, // Firefox
  /ChunkLoadError/i,
  /Loading (CSS )?chunk [\w-]+ failed/i,
  /unable to preload css/i, // Vite
];

export function classifyAppError(error: unknown): AppErrorKind {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === 'string' ? error : '';
  return OUTDATED_PATTERNS.some((pattern) => pattern.test(text)) ? 'outdated' : 'unexpected';
}

/**
 * Ghi lỗi ra console cho kỹ thuật viên chẩn đoán — CHỈ tên và thông điệp, không ghi đối tượng lỗi đầy đủ/ngăn xếp/dữ liệu form
 * (CLAUDE.md: không log PII/PHI). Người dùng cuối không bao giờ thấy nội dung này trên màn hình.
 */
export function logAppError(error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  console.error('[app-error]', name, message);
}
