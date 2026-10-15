import type { ReleaseEntry, UpdateChannel } from '@nexamed/shared';

/**
 * Hỏi máy chủ phát hành xem có bản mới không (docs/DECISIONS.md #236, bước 2) — xem `.claude/docs/project-structure.md` bảng Port/adapter. v1 có một adapter đọc file khai báo
 * `manifest.json` qua HTTPS (`apps/api/src/infrastructure/update/`); sau này đổi nơi phát hành (kho ảnh, đối tượng lưu trữ) chỉ thay adapter, không sửa service.
 * Cổng này CHỈ KIỂM TRA — việc tải ảnh và áp dụng cập nhật là bước sau và sẽ có cổng riêng.
 */
export type UpdateCheckResult =
  /** `latest = null`: máy chủ phát hành trả lời bình thường nhưng kênh này chưa có bản nào. */
  | { kind: 'ok'; latest: ReleaseEntry | null }
  /** Lỗi mạng/định dạng/cấu hình sai — `message` viết sẵn tiếng Việt cho người dùng, không lộ chi tiết nội bộ. */
  | { kind: 'error'; message: string };

export interface UpdateCheckPort {
  /** Nhà cung cấp đã cấu hình địa chỉ máy chủ phát hành chưa (biến môi trường `RELEASE_SERVER_URL`, khách không nhập được trên giao diện). */
  isConfigured(): boolean;
  /** Địa chỉ máy chủ phát hành — chỉ để HIỂN THỊ; `null` khi chưa cấu hình. */
  getServerUrl(): string | null;
  /** Hỏi bản mới nhất của một kênh. Không bao giờ ném lỗi: mọi sự cố trả về `{ kind: 'error' }`. */
  fetchLatest(channel: UpdateChannel): Promise<UpdateCheckResult>;
}

export const UPDATE_CHECK_PORT = Symbol('UPDATE_CHECK_PORT');
