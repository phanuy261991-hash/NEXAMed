import type { EncryptionKeyStatusResponse } from '@nexamed/shared';

/** Chữ hiện thay giá trị mã hoá khi khoá hệ thống không khớp dữ liệu (docs/DECISIONS.md #262, mockup B đã chốt 24/10/2026). */
export const UNREADABLE_LABEL = 'Không đọc được';

/** Dòng giải thích ngắn đi kèm khi chỗ hiển thị đủ rộng. */
export const UNREADABLE_HINT = 'Không đọc được — khoá hệ thống không khớp';

export interface EncryptionKeyBannerView {
  title: string;
  /** Câu mô tả hai mã kiểm khoá (đang chạy / dữ liệu). */
  detail: string;
  /** Câu hướng dẫn việc cần làm (không nhập lại dữ liệu để "sửa"). */
  action: string;
}

/**
 * Nội dung cảnh báo đỏ ở đầu trang. Chỉ dựng khi `state === 'mismatch'` VÀ người xem là quản trị (`canSeeDetails`): người khác không cần và không được thấy mã kiểm khoá —
 * họ chỉ thấy dòng "Không đọc được" ở chính trường mã hoá. `expectedFingerprint` null = không biết mã gốc (hệ thống cài trước bản kiểm tra khoá và khoá đã sai ngay từ đầu).
 */
export function buildEncryptionKeyBanner(status: EncryptionKeyStatusResponse | undefined): EncryptionKeyBannerView | null {
  if (!status || status.state !== 'mismatch' || !status.canSeeDetails) return null;
  const actual = status.actualFingerprint ?? '—';
  const expected = status.expectedFingerprint;
  const detail = expected
    ? `Khoá đang dùng có mã kiểm ${actual}, nhưng dữ liệu được tạo bằng khoá có mã kiểm ${expected} (ghi trên file khoá lúc cài). Thường xảy ra khi khôi phục sao lưu sang máy mới mà thiếu file .env gốc.`
    : `Khoá đang dùng có mã kiểm ${actual}, còn dữ liệu đã được mã hoá bằng một khoá khác (không rõ mã kiểm). Thường xảy ra khi khôi phục sao lưu sang máy mới mà thiếu file .env gốc.`;
  const action = expected
    ? `Đừng nhập lại CCCD/thẻ BHYT để "sửa" — hãy đặt lại đúng file .env có khoá mã kiểm ${expected} rồi khởi động lại hệ thống.`
    : 'Đừng nhập lại CCCD/thẻ BHYT để "sửa" — hãy tìm lại file khoá lúc cài đặt, đặt đúng khoá vào file .env rồi khởi động lại hệ thống.';
  return { title: 'Khoá hệ thống KHÔNG khớp với dữ liệu đã lưu — số CCCD và thẻ BHYT hiện không đọc được', detail, action };
}

/** Các bước khôi phục hiện trong hộp "Xem hướng dẫn khôi phục" (cùng nội dung phần "CÁCH KHÔI PHỤC" của file khoá tải lúc cài). */
export const RECOVERY_STEPS: ReadonlyArray<string> = [
  'Tìm file khoá hệ thống đã tải lúc cài (NEXAMed-khoa-he-thong.txt) ở USB, két hoặc nơi cất riêng.',
  'Mở file .env trong thư mục cài đặt của máy chủ, sửa dòng ENCRYPTION_KEY= thành đúng dòng ENCRYPTION_KEY=... trong file khoá.',
  'Khởi động lại hệ thống (docker compose restart api). Cảnh báo này sẽ tự mất khi mã kiểm khoá khớp lại.',
  'Không có file khoá? Dữ liệu mã hoá không thể khôi phục — liên hệ đơn vị hỗ trợ trước khi làm bất cứ điều gì khác.',
];
