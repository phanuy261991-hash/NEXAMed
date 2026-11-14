import { DomainError } from './domain-error';

/** Tệp tải lên "Hình ảnh & Tài liệu" không hợp lệ: sai định dạng (kiểm magic byte), rỗng hoặc vượt dung lượng (docs/DECISIONS.md #299). */
export class PatientDocumentInvalidFileError extends DomainError {
  readonly code = 'PATIENT_DOCUMENT_INVALID_FILE';

  constructor(message: string) {
    super(message);
  }
}

/** Đã có tệp tải tay cùng tên (không phân biệt hoa thường) trong hồ sơ bệnh nhân này — tải lên hoặc đổi tên đều bị chặn. */
export class PatientDocumentNameTakenError extends DomainError {
  readonly code = 'PATIENT_DOCUMENT_NAME_TAKEN';

  constructor(name: string) {
    super(`Đã có tệp tên "${name}" trong hồ sơ này. Hãy đổi tên tệp rồi tải lại.`);
  }
}

/** Tên thư mục tự tạo đã có trong hồ sơ bệnh nhân này (không phân biệt hoa thường). */
export class PatientDocumentFolderNameTakenError extends DomainError {
  readonly code = 'PATIENT_DOCUMENT_FOLDER_NAME_TAKEN';

  constructor() {
    super('Đã có thư mục cùng tên trong hồ sơ này, hãy đặt tên khác.');
  }
}

/** Xoá thư mục còn tệp bên trong. */
export class PatientDocumentFolderNotEmptyError extends DomainError {
  readonly code = 'PATIENT_DOCUMENT_FOLDER_NOT_EMPTY';

  constructor(count: number) {
    super(`Thư mục còn ${count} tệp. Chuyển hoặc xoá các tệp trước.`);
  }
}

/** Dòng tham chiếu từ nơi khác (kết quả cận lâm sàng, thẻ BHYT...) chỉ đọc: sửa hoặc xoá ở chỗ gốc. */
export class PatientDocumentReadOnlyError extends DomainError {
  readonly code = 'PATIENT_DOCUMENT_READ_ONLY';

  constructor() {
    super('Tệp này lấy từ nơi khác trong hồ sơ nên chỉ xem được. Muốn sửa hoặc gỡ, hãy làm ở chỗ gốc.');
  }
}
