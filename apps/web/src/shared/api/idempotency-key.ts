/**
 * Khoá chống ghi trùng phía giao diện (docs/DECISIONS.md #257). `client.ts` gắn header `Idempotency-Key` vào mọi POST JSON; máy chủ nhận ra lần gửi lại cùng khoá
 * và trả đúng kết quả lần đầu thay vì ghi thêm một bản (kịch bản: mạng đứt đúng lúc máy chủ vừa ghi xong, người dùng bấm lại).
 *
 * Cách chọn khoá: cùng MỘT thao tác logic (cùng phương thức + địa chỉ + nội dung) thì cùng khoá cho tới khi có kết luận. Nhờ vậy bấm đúp, hoặc bấm lại sau khi mạng đứt,
 * tự dùng lại khoá cũ — KHÔNG cần sửa từng form. Thao tác thành công hay bị từ chối rõ ràng (4xx) thì khoá được bỏ, lần gửi sau (kể cả nội dung y hệt, cố ý) là thao tác mới.
 * Khoá chỉ giữ trong bộ nhớ trang: tải lại trang là mất (form cũng mất theo).
 */

import { generateUuid } from '../uuid';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/** Giữ khoá chưa có kết luận tối đa chừng này; quá hạn thì lần gửi sau coi là thao tác mới. */
export const IDEMPOTENCY_KEY_RETENTION_MS = 10 * 60_000;

/** Chỉ POST JSON được gắn khoá: tải tệp (multipart) và các đường đăng nhập/làm mới phiên không cần, và không ghi nội dung được so sánh. */
export function shouldAttachIdempotencyKey(method: string, url: string, contentType: string | null): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  if (url.includes('/api/v1/auth/')) return false;
  return (contentType ?? '').toLowerCase().includes('application/json');
}

/**
 * Sau khi có phản hồi, khoá còn phải giữ không? GIỮ khi chưa biết thao tác đã xảy ra hay chưa: lỗi máy chủ/proxy (5xx), hoặc 409 (có thể là "lần trước còn đang xử lý" —
 * nếu là xung đột khác thì máy chủ đã nhả khoá nên gửi lại cùng khoá vẫn chạy bình thường). BỎ khi đã có kết luận: thành công, hoặc bị từ chối rõ ràng.
 */
export function shouldKeepKeyAfterResponse(status: number): boolean {
  return status >= 500 || status === 409;
}

export interface IdempotencyKeyStore {
  /** Khoá cho thao tác này: dùng lại khoá còn hạn của cùng thao tác, nếu không thì sinh khoá mới. */
  acquire(fingerprint: string): string;
  /** Báo kết luận. `status` = mã HTTP của phản hồi; `null` = không nhận được phản hồi (mất mạng) → giữ khoá. */
  settle(fingerprint: string, status: number | null): void;
}

export function createIdempotencyKeyStore(options: { now?: () => number; generate?: () => string; retentionMs?: number } = {}): IdempotencyKeyStore {
  const now = options.now ?? Date.now;
  const generate = options.generate ?? generateUuid;
  const retentionMs = options.retentionMs ?? IDEMPOTENCY_KEY_RETENTION_MS;
  const entries = new Map<string, { key: string; at: number }>();

  function prune(): void {
    const cutoff = now() - retentionMs;
    for (const [fingerprint, entry] of entries) if (entry.at < cutoff) entries.delete(fingerprint);
  }

  return {
    acquire(fingerprint) {
      prune();
      const existing = entries.get(fingerprint);
      if (existing) return existing.key;
      const key = generate();
      entries.set(fingerprint, { key, at: now() });
      return key;
    },
    settle(fingerprint, status) {
      if (status === null || shouldKeepKeyAfterResponse(status)) return;
      entries.delete(fingerprint);
    },
  };
}
