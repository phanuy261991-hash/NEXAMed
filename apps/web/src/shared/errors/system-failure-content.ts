import type { SystemFailureKind } from './system-failure';

/**
 * Nội dung hộp báo lỗi HỆ THỐNG khi đang thao tác (mất mạng, máy chủ chưa bật, 5xx) — phương án A của mockup đã chốt 31/10/2026 (docs/DECISIONS.md #273): tiêu đề + MỘT câu dẫn + ba dòng thông tin
 * có biểu tượng, thay cho đoạn chữ xám 5 dòng trước đây. Phần thuần (chữ, màu, biểu tượng theo khoá) tách khỏi component để kiểm bằng unit test.
 *
 * Về dòng "Bấm lại là an toàn": khi mất kết nối, máy chủ CÓ THỂ đã ghi xong mà chỉ chưa kịp trả lời — nên KHÔNG được khẳng định "chưa thực hiện". Từ #257 (khoá chống ghi trùng) bấm lại là AN TOÀN:
 * giao diện giữ nguyên khoá của thao tác và máy chủ trả lại đúng kết quả lần đầu nếu nó đã được ghi.
 */
export type FailureTone = 'amber' | 'rose';
/** `wait` = việc chưa rõ kết quả (màu theo tông hộp); `safe`/`kept` = điều đã chắc chắn (xanh lá). */
export type FailureItemKind = 'wait' | 'safe' | 'kept';
export type FailureHeaderIcon = 'offline' | 'warning';

export interface FailureItem {
  kind: FailureItemKind;
  label: string;
  detail: string;
}

export interface FailureContent {
  /** Lỗi tạm thời (mất mạng, máy chủ chưa bật) dùng cam; lỗi thật của hệ thống dùng đỏ. */
  tone: FailureTone;
  icon: FailureHeaderIcon;
  title: string;
  lead: string;
  items: FailureItem[];
}

const SAFE_RETRY: FailureItem = { kind: 'safe', label: 'Bấm lại là an toàn', detail: 'Hệ thống tự nhận ra, không ghi trùng' };
const DATA_KEPT: FailureItem = { kind: 'kept', label: 'Dữ liệu đã nhập', detail: 'Còn nguyên trên màn hình' };
const UNKNOWN_RESULT: FailureItem = { kind: 'wait', label: 'Thao tác vừa rồi', detail: 'Chưa rõ đã xong hay chưa' };

export const SYSTEM_FAILURE_CONTENT: Record<SystemFailureKind, FailureContent> = {
  network: {
    tone: 'amber',
    icon: 'offline',
    title: 'Chưa kết nối được máy chủ',
    lead: 'Kiểm tra mạng hoặc Wi-Fi của máy này.',
    items: [UNKNOWN_RESULT, SAFE_RETRY, DATA_KEPT],
  },
  unavailable: {
    tone: 'amber',
    icon: 'offline',
    title: 'Hệ thống tạm thời chưa dùng được',
    lead: 'Đang khởi động hoặc bảo trì. Đợi vài phút rồi thử lại.',
    items: [UNKNOWN_RESULT, SAFE_RETRY, DATA_KEPT],
  },
  server: {
    tone: 'rose',
    icon: 'warning',
    title: 'Hệ thống đang gặp sự cố',
    lead: 'Nếu thử lại vẫn lỗi, hãy báo người quản trị.',
    items: [{ kind: 'wait', label: 'Thao tác vừa rồi', detail: 'Có thể chưa được ghi nhận' }, SAFE_RETRY, DATA_KEPT],
  },
};
