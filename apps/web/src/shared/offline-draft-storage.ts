/**
 * Lưu/đọc/xoá nháp offline dạng JSON trong `localStorage` — dùng chung cho mọi form cần "lưu nháp
 * phía client khi mất kết nối, gửi lại khi có mạng" (ENC-06, `EncounterConsultationPage.tsx` là
 * nơi dùng đầu tiên). Đặt ở `shared/` với chủ đích tái dùng ngay từ lần viết đầu tiên
 * (`CLAUDE.md`) — mẫu "nháp offline" này sẽ còn cần cho các form nhập liệu dài khác sau này.
 *
 * KHÔNG mã hoá nội dung — chấp nhận được ở v1 vì đây là bản sao TẠM THỜI trên chính máy bác sĩ
 * đang gõ, tự xoá ngay khi đồng bộ thành công (thường trong vài giây-phút). Nếu mở rộng offline
 * cho phạm vi lớn hơn/thời gian tồn tại lâu hơn thì cần mã hoá — xem `docs/product/
 * pwa-offline-analysis.md` mục 2.4.
 */
export interface OfflineDraftEnvelope<T> {
  /** ISO timestamp — lúc GHI nháp này (không phải lúc dữ liệu gốc được tạo). */
  savedAt: string;
  payload: T;
}

export function readOfflineDraft<T>(key: string): OfflineDraftEnvelope<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as OfflineDraftEnvelope<T>;
  } catch {
    return null;
  }
}

export function writeOfflineDraft<T>(key: string, payload: T): void {
  try {
    const envelope: OfflineDraftEnvelope<T> = { savedAt: new Date().toISOString(), payload };
    localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // localStorage đầy/bị chặn (chế độ ẩn danh, quyền trình duyệt...) — bỏ qua, không phải lỗi
    // nghiêm trọng của tính năng chính (bác sĩ vẫn thấy nội dung đang gõ trên màn hình, chỉ là
    // không có thêm lưới an toàn nếu tắt hẳn trình duyệt lúc đang offline).
  }
}

export function clearOfflineDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // no-op — cùng lý do ở trên.
  }
}
