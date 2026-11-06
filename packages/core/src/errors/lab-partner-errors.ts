import { DomainError } from './domain-error';

/** Công tắc "Dùng đối tác xét nghiệm" đang TẮT (#291) — mọi API ghi dữ liệu đối tác/gửi mẫu bị từ chối. 409. */
export class LabPartnerDisabledError extends DomainError {
  readonly code = 'LAB_PARTNER_DISABLED';

  constructor() {
    super('Phòng khám đã tắt tính năng "Dùng đối tác xét nghiệm" ở Cấu hình chung.');
  }
}

/** Bỏ đánh dấu "Đối tác xét nghiệm" khi nhà cung cấp còn giá trả theo dịch vụ (#291). 409. */
export class LabPartnerInUseError extends DomainError {
  readonly code = 'LAB_PARTNER_IN_USE';

  constructor() {
    super("Đối tác còn giá trả theo dịch vụ. Gỡ đối tác khỏi các dịch vụ trước khi bỏ đánh dấu.");
  }
}
