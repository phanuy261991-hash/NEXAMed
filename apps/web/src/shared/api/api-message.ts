/**
 * Chuẩn hoá thông điệp lỗi từ máy chủ trước khi đưa lên giao diện (docs/DECISIONS.md #255: không lộ mã, lỗi thô hay tiếng Anh kỹ thuật cho
 * người dùng cuối). Logic thuần — mọi nơi dựng `ApiError` (`unwrap`, tải/tải lên tệp, xuất bệnh án) đều đi qua đây, nên KHÔNG chỗ nào đưa
 * nguyên `message` của máy chủ lên màn hình mà chưa qua kiểm tra mã HTTP + nội dung.
 */

/** Câu mặc định theo mã HTTP, dùng khi máy chủ không trả thông điệp dùng được cho người dùng cuối. */
const MESSAGE_BY_STATUS: Record<number, string> = {
  400: 'Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra lại.',
  401: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
  403: 'Bạn không có quyền thực hiện thao tác này.',
  404: 'Không tìm thấy nội dung yêu cầu.',
  405: 'Thao tác này không được hỗ trợ.',
  408: 'Máy chủ phản hồi quá chậm. Vui lòng thử lại.',
  409: 'Dữ liệu vừa thay đổi hoặc xung đột với dữ liệu hiện có. Vui lòng tải lại rồi thử lại.',
  413: 'Dữ liệu gửi lên quá lớn.',
  415: 'Định dạng dữ liệu không được hỗ trợ.',
  422: 'Dữ liệu chưa hợp lệ. Vui lòng kiểm tra lại.',
  429: 'Bạn thao tác quá nhanh. Vui lòng chờ một lát rồi thử lại.',
  500: 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau ít phút.',
  502: 'Hệ thống đang khởi động hoặc tạm thời không truy cập được. Vui lòng thử lại sau ít phút.',
  503: 'Hệ thống đang khởi động hoặc tạm thời không truy cập được. Vui lòng thử lại sau ít phút.',
  504: 'Hệ thống phản hồi quá chậm. Vui lòng thử lại sau ít phút.',
};

/** Mã lỗi nội bộ khi máy chủ không trả `code` (ví dụ lỗi do nginx/proxy trả về) — để các nơi dựa vào `code` (404/403/xung đột) vẫn chạy đúng. */
const CODE_BY_STATUS: Record<number, string> = {
  401: 'UNAUTHENTICATED',
  403: 'PERMISSION_DENIED',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'TOO_MANY_REQUESTS',
  502: 'SERVICE_UNAVAILABLE',
  503: 'SERVICE_UNAVAILABLE',
  504: 'SERVICE_UNAVAILABLE',
};

const VIETNAMESE_LETTER = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
/** Dấu hiệu của thông điệp kỹ thuật/thô tuyệt đối không được hiện cho người dùng cuối. */
const TECHNICAL_MARKER = /\b(Error|Exception|undefined|null|NaN|stack|ECONN\w*|ENOTFOUND|ETIMEDOUT|SQL|prisma|Zod|TypeError|ReferenceError|SyntaxError|JSON|Unexpected token|at \w+\.\w+)\b|<\/?[a-z][^>]*>|\.(ts|tsx|js|mjs)\b/i;
const MAX_USER_MESSAGE_LENGTH = 400;

/**
 * Thông điệp có dùng được cho người dùng cuối không: là câu tiếng Việt (có chữ có dấu), không quá dài, không chứa dấu hiệu kỹ thuật (tên lỗi,
 * mã `ECONN…`, đoạn HTML, tên tệp mã nguồn…). Thông điệp nghiệp vụ do máy chủ chủ đích trả đều tiếng Việt nên qua được; thông điệp mặc định tiếng
 * Anh của framework ("Bad Request", "Unauthorized", "Validation failed (uuid is expected)", "Cannot GET /x") bị loại.
 */
export function isUserFacingMessage(message: unknown): message is string {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (text.length === 0 || text.length > MAX_USER_MESSAGE_LENGTH) return false;
  if (TECHNICAL_MARKER.test(text)) return false;
  return VIETNAMESE_LETTER.test(text);
}

/** Thông điệp để hiện cho người dùng: dùng lại câu của máy chủ nếu đạt, không thì dùng câu mặc định theo mã HTTP, không có nữa thì `fallback`. */
export function friendlyApiMessage(status: number | undefined, serverMessage: unknown, fallback = 'Có lỗi xảy ra, vui lòng thử lại.'): string {
  if (isUserFacingMessage(serverMessage)) return serverMessage.trim();
  if (status !== undefined) {
    const byStatus = MESSAGE_BY_STATUS[status] ?? (status >= 500 ? MESSAGE_BY_STATUS[500] : undefined);
    if (byStatus) return byStatus;
  }
  return fallback;
}

/** Mã lỗi nội bộ: ưu tiên `code` máy chủ trả; thiếu thì suy từ mã HTTP. */
export function resolveApiErrorCode(status: number | undefined, serverCode: unknown): string {
  if (typeof serverCode === 'string' && serverCode.length > 0) return serverCode;
  if (status !== undefined) return CODE_BY_STATUS[status] ?? (status >= 500 ? 'SERVER_ERROR' : 'UNKNOWN_ERROR');
  return 'UNKNOWN_ERROR';
}
