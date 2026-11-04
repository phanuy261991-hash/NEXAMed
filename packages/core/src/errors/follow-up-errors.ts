import { DomainError } from './domain-error';

/** Công tắc "Dùng Hẹn tái khám" đang TẮT (#285) — mọi API của trang "Hẹn tái khám" bị từ chối. 409. */
export class FollowUpDisabledError extends DomainError {
  readonly code = 'FOLLOW_UP_DISABLED';

  constructor() {
    super('Phòng khám đã tắt tính năng "Hẹn tái khám" ở Cấu hình phòng khám.');
  }
}
