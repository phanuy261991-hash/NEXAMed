/**
 * Cổng Đơn thuốc quốc gia (donthuocquocgia.vn, Quyết định 808/QĐ-BYT) — xem `.claude/docs/project-structure.md` bảng Port/adapter và `docs/product/prescription-code-moh.md` mục 9.
 * Từ #242 giai đoạn 3 (chủ dự án yêu cầu dựng khung kết nối sẵn): đăng nhập cơ sở, thêm/xoá bác sĩ khỏi cơ sở, đăng nhập bác sĩ. Gửi đơn (`gui-don-thuoc`) bổ sung khi có hàm dựng gói.
 * Adapter HTTP thật ở `apps/api/src/infrastructure/e-prescription/`; mọi tham số kết nối (địa chỉ, thời gian chờ) do nơi gọi truyền vào từ cấu hình "Liên thông đơn thuốc" — adapter KHÔNG giữ cấu hình.
 *
 * Chưa kiểm với cổng thật: tài liệu chưa nêu môi trường thử, định dạng `danh_sach_cac_loi` và một số tên trường còn mơ hồ (xem `docs/product/prescription-interop-questions.md`).
 * Chữ ký số (`signature`) vẫn chưa có (`SignaturePort` no-op); cổng có nhận đơn thiếu chữ ký hay không là câu hỏi đang chờ trả lời.
 */
export interface EPrescriptionGatewayEndpoint {
  /** Địa chỉ máy chủ, đã bỏ dấu `/` cuối (ví dụ `https://api.donthuocquocgia.vn`). */
  baseUrl: string;
  /** Thời gian chờ mỗi lần gọi (mili giây). */
  timeoutMs: number;
}

/**
 * Kết quả một lần gọi cổng. KHÔNG ném lỗi: mọi sự cố trả về một trong các nhánh dưới để nơi gọi quyết định thử lại hay báo người dùng.
 * - `rejected`: cổng trả lỗi nghiệp vụ (422/4xx khác) kèm `errors` (nội dung `danh_sach_cac_loi` đã đọc ra chuỗi; có thể rỗng nếu cổng không nêu).
 * - `unauthorized`: 401 — token hết hạn/không hợp lệ (nơi gọi đăng nhập lại rồi thử lại MỘT lần).
 * - `unreachable`: lỗi mạng, hết thời gian chờ, 5xx hoặc phản hồi không đọc được — đáng thử lại sau.
 */
export type EPrescriptionGatewayResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'rejected'; status: number; errors: string[] }
  | { kind: 'unauthorized'; errors: string[] }
  /** `message` = LÝ DO ngắn bằng tiếng Việt, không viết hoa đầu và không dấu chấm cuối (nơi gọi ghép vào câu thông báo), ví dụ "hết thời gian chờ 30 giây". */
  | { kind: 'unreachable'; message: string };

export interface EPrescriptionGatewayPort {
  /** API III — đăng nhập cơ sở khám chữa bệnh bằng mã liên thông + mật khẩu của cơ sở; trả token (7 ngày) để thêm/xoá bác sĩ. */
  loginFacility(endpoint: EPrescriptionGatewayEndpoint, credential: { facilityCode: string; password: string }): Promise<EPrescriptionGatewayResult<{ token: string }>>;
  /** API IV — thêm bác sĩ vào cơ sở (header bearer = token cơ sở). */
  addDoctorToFacility(endpoint: EPrescriptionGatewayEndpoint, facilityToken: string, doctorCode: string): Promise<EPrescriptionGatewayResult<{ message: string }>>;
  /** API V — xoá bác sĩ khỏi cơ sở (header bearer = token cơ sở). */
  removeDoctorFromFacility(endpoint: EPrescriptionGatewayEndpoint, facilityToken: string, doctorCode: string): Promise<EPrescriptionGatewayResult<{ message: string }>>;
  /** API VI — đăng nhập bác sĩ (mã bác sĩ + mã liên thông cơ sở + mật khẩu của BÁC SĨ); lỗi 422 nếu bác sĩ chưa được thêm vào cơ sở. */
  loginDoctor(endpoint: EPrescriptionGatewayEndpoint, credential: { doctorCode: string; facilityCode: string; password: string }): Promise<EPrescriptionGatewayResult<{ token: string }>>;
}

export const E_PRESCRIPTION_GATEWAY_PORT = Symbol('E_PRESCRIPTION_GATEWAY_PORT');
