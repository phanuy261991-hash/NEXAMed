import { DomainError } from './domain-error';

/** Dòng chỉ định không ở trạng thái cho phép thao tác (ví dụ lấy mẫu dòng đã lấy rồi, nhập kết quả dòng chưa lấy mẫu, sửa kết quả đã duyệt). */
export class ParaclinicalItemInvalidStateError extends DomainError {
  readonly code = 'PARACLINICAL_ITEM_INVALID_STATE';

  constructor(message: string) {
    super(message);
  }
}

/** Chưa thu tiền mà phòng khám không bật "cho thực hiện trước khi thu tiền". */
export class ParaclinicalPaymentRequiredError extends DomainError {
  readonly code = 'PARACLINICAL_PAYMENT_REQUIRED';

  constructor() {
    super('Dịch vụ này chưa thu tiền — thu tiền ở Thu ngân trước khi lấy mẫu / gọi vào phòng.');
  }
}

/** Gửi duyệt / duyệt khi kết quả còn thiếu (chưa nhập chỉ số, thiếu mô tả hoặc kết luận) hoặc giá trị không hợp lệ. */
export class ParaclinicalResultIncompleteError extends DomainError {
  readonly code = 'PARACLINICAL_RESULT_INCOMPLETE';

  constructor(message: string) {
    super(message);
  }
}
