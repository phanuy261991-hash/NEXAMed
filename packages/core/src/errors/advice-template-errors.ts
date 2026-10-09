import { DomainError } from './domain-error';

/** Trùng tên mẫu lời dặn (không phân biệt hoa thường) trong cùng phòng khám — unique index `advice_template_name_key` (docs/DECISIONS.md #222). */
export class AdviceTemplateDuplicateNameError extends DomainError {
  readonly code = 'ADVICE_TEMPLATE_DUPLICATE_NAME';

  constructor() {
    super('Tên mẫu lời dặn này đã tồn tại.');
  }
}

/** Ngày hẹn tái khám không hợp lệ (không sau ngày khám, quá 365 ngày, hoặc thiếu/thừa ngày so với hướng "Hẹn tái khám") — docs/DECISIONS.md #222. */
export class FollowUpDateInvalidError extends DomainError {
  readonly code = 'FOLLOW_UP_DATE_INVALID';

  constructor(message: string) {
    super(message);
  }
}
