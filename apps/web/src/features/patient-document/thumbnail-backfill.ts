import type { PatientDocument } from '@nexamed/shared';
import { THUMBNAIL_MAX_SIDE } from './make-thumbnail';

/**
 * Tạo ảnh thu nhỏ BÙ cho tệp ảnh chưa có (docs/DECISIONS.md #299 bổ sung 5): tệp tải trước giai đoạn 3 và dòng tự gộp (kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện) không có ảnh thu nhỏ lúc tạo.
 * Khi ô ảnh tải xong ảnh gốc để hiện, trình duyệt vẽ lại thành ảnh nhỏ rồi gửi lên MỘT lần; các lần xem sau (và người khác) dùng ảnh nhỏ. Việc này chạy ngầm, lần lượt từng ảnh, lỗi thì bỏ qua
 * (chỉ là bộ nhớ đệm hiển thị — ô ảnh vẫn hiện ảnh gốc, lần mở sau thử lại).
 */

/** Chỉ ảnh còn chưa có ảnh thu nhỏ và đủ lớn (cạnh dài > cạnh ảnh thu nhỏ) mới đáng làm; ảnh nhỏ sẵn rồi thì thôi. Thuần để kiểm bằng unit test. */
export function needsThumbnailBackfill(doc: Pick<PatientDocument, 'kind' | 'thumbnailUrl'>, naturalWidth: number, naturalHeight: number): boolean {
  return doc.kind === 'image' && doc.thumbnailUrl === null && Math.max(naturalWidth, naturalHeight) > THUMBNAIL_MAX_SIDE;
}

const attempted = new Set<string>();
const queue: (() => Promise<void>)[] = [];
let running = false;

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift() as () => Promise<void>;
    try {
      await job();
    } catch {
      // Bộ nhớ đệm hiển thị: tạo/gửi không được thì bỏ qua, ô ảnh vẫn hiện ảnh gốc và lần mở sau thử lại.
    }
  }
  running = false;
}

/** Xếp một việc bù ảnh thu nhỏ vào hàng đợi (mỗi tệp chỉ thử MỘT lần trong một phiên làm việc; chạy lần lượt để không nghẽn mạng khi lưới có nhiều ảnh). */
export function queueThumbnailBackfill(key: string, job: () => Promise<void>): boolean {
  if (attempted.has(key)) return false;
  attempted.add(key);
  queue.push(job);
  void pump();
  return true;
}

/** Chỉ dùng trong test: xoá trạng thái hàng đợi giữa các ca. */
export function resetThumbnailBackfillForTest(): void {
  attempted.clear();
  queue.length = 0;
  running = false;
}
