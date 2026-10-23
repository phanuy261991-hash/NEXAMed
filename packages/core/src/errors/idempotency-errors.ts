import { DomainError } from './domain-error';

/**
 * Khoá chống ghi trùng (docs/DECISIONS.md #257). Giao diện gửi `Idempotency-Key` (UUID) cho mọi thao tác ghi dạng POST và giữ nguyên khoá khi người dùng bấm lại
 * sau lúc mạng đứt; máy chủ nhận ra lần gửi lại và trả đúng kết quả của lần đầu thay vì ghi thêm một bản.
 */

/** Giá trị header `Idempotency-Key` không phải UUID — lỗi của phía gọi (giao diện luôn sinh UUID). */
export class IdempotencyKeyInvalidError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_INVALID';

  constructor() {
    super('Mã chống ghi trùng không hợp lệ.');
  }
}

/** Cùng khoá nhưng nội dung yêu cầu khác lần đầu — không thể là "bấm lại", là dùng lại khoá sai cách. */
export class IdempotencyKeyReusedError extends DomainError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('Thao tác này khác với lần gửi trước dùng cùng mã. Hãy tải lại màn hình rồi thực hiện lại.');
  }
}

/** Lần gửi đầu vẫn đang xử lý quá lâu — người dùng chờ rồi thử lại, không ghi thêm. */
export class IdempotencyInProgressError extends DomainError {
  readonly code = 'IDEMPOTENCY_IN_PROGRESS';

  constructor() {
    super('Thao tác trước đó của bạn vẫn đang được xử lý. Vui lòng chờ giây lát rồi kiểm tra lại kết quả.');
  }
}

/** Lần gửi đầu đã thực hiện xong nhưng kết quả quá lớn để lưu lại — không trả lại được nguyên văn, KHÔNG ghi lại lần nữa. */
export class IdempotencyReplayUnavailableError extends DomainError {
  readonly code = 'IDEMPOTENCY_REPLAY_UNAVAILABLE';

  constructor() {
    super('Thao tác này đã được thực hiện trước đó. Hãy tải lại màn hình để xem kết quả.');
  }
}
