import { DomainError } from './domain-error';

/** Máy này không có container sao lưu để điều khiển (máy dev/bản cloud) — cấu hình sao lưu từ giao diện không áp dụng. */
export class BackupNotAvailableError extends DomainError {
  readonly code = 'BACKUP_NOT_AVAILABLE';

  constructor() {
    super('Máy chủ này không chạy dịch vụ sao lưu tự động nên không cấu hình được từ đây.');
  }
}
