import { DomainError } from './domain-error';

/** Chứng từ này đã có bản mẫu cho khổ giấy đó — mỗi chứng từ chỉ 1 bản mẫu cho mỗi khổ ("Quản lý mẫu in", #211). */
export class PrintTemplateDuplicatePaperError extends DomainError {
  readonly code = 'PRINT_TEMPLATE_DUPLICATE_PAPER';

  constructor() {
    super('Chứng từ này đã có bản mẫu cho khổ giấy đó — chọn khổ khác hoặc sửa bản mẫu hiện có.');
  }
}

/** Khổ giấy không được mở cho loại chứng từ này (ví dụ K80 chỉ dành cho 4 chứng từ tiền). */
export class PrintTemplatePaperNotAllowedError extends DomainError {
  readonly code = 'PRINT_TEMPLATE_PAPER_NOT_ALLOWED';

  constructor() {
    super('Khổ giấy này không dùng được cho loại chứng từ đã chọn.');
  }
}

/** Không xoá được bản mẫu đang là mặc định khi chứng từ còn bản mẫu khác — đặt bản khác làm mặc định trước. */
export class PrintTemplateDefaultCannotDeleteError extends DomainError {
  readonly code = 'PRINT_TEMPLATE_DEFAULT_CANNOT_DELETE';

  constructor() {
    super('Đây là bản mẫu mặc định — hãy đặt một bản mẫu khác làm mặc định trước khi xoá.');
  }
}
