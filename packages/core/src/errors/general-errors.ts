import { DomainError } from './domain-error';

/**
 * Vi phạm optimistic locking (`UPDATE ... WHERE version = ?` không khớp dòng nào) — dùng chung
 * cho mọi bảng nghiệp vụ, không riêng module nào. Xem .claude/docs/data-model.md.
 */
export class ConcurrentModificationError extends DomainError {
  readonly code = 'CONCURRENT_MODIFICATION';

  constructor() {
    super('Dữ liệu đã được người khác cập nhật, vui lòng tải lại trang.');
  }
}
