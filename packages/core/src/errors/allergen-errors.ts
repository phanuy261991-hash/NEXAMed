import { DomainError } from './domain-error';

/** DB trả unique violation trên `allergen_group.code` — trùng mã tự sinh (retry hết lượt). */
export class AllergenGroupDuplicateCodeError extends DomainError {
  readonly code = 'ALLERGEN_GROUP_DUPLICATE_CODE';

  constructor() {
    super('Mã nhóm dị nguyên này đã tồn tại.');
  }
}

/** DB trả unique violation trên `allergen.code` — trùng mã tự sinh (retry hết lượt). */
export class AllergenDuplicateCodeError extends DomainError {
  readonly code = 'ALLERGEN_DUPLICATE_CODE';

  constructor() {
    super('Mã dị nguyên này đã tồn tại.');
  }
}

/** `allergenGroupId` gửi lên tạo/sửa Dị nguyên không tồn tại hoặc đã bị ẩn. */
export class AllergenGroupInvalidReferenceError extends DomainError {
  readonly code = 'ALLERGEN_GROUP_INVALID_REFERENCE';

  constructor() {
    super('Nhóm dị nguyên đã chọn không tồn tại.');
  }
}
