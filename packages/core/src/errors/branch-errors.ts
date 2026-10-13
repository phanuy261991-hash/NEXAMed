import { DomainError } from './domain-error';

/** Phiên đăng nhập chưa gắn chi nhánh làm việc (được gán nhiều chi nhánh mà chưa chọn) — web hiện màn "Chọn chi nhánh làm việc". */
export class BranchNotSelectedError extends DomainError {
  readonly code = 'BRANCH_NOT_SELECTED';

  constructor() {
    super('Bạn chưa chọn chi nhánh làm việc.');
  }
}

/** Đổi sang chi nhánh mà tài khoản không được gán (hoặc chi nhánh đã ngưng). */
export class BranchNotAssignedError extends DomainError {
  readonly code = 'BRANCH_NOT_ASSIGNED';

  constructor() {
    super('Bạn không được làm việc ở chi nhánh này.');
  }
}

/** `branchIds` gửi lên không tồn tại / đã ngưng / không thuộc công ty. */
export class BranchInvalidReferenceError extends DomainError {
  readonly code = 'BRANCH_INVALID_REFERENCE';

  constructor() {
    super('Chi nhánh đã chọn không tồn tại hoặc đã ngưng hoạt động.');
  }
}

/** Công ty có từ 2 chi nhánh trở lên thì mỗi tài khoản phải được gán ít nhất 1 chi nhánh. */
export class UserBranchRequiredError extends DomainError {
  readonly code = 'USER_BRANCH_REQUIRED';

  constructor() {
    super('Phải chọn ít nhất một chi nhánh làm việc cho tài khoản.');
  }
}

/** Chi nhánh mặc định không ngưng được (mọi công ty luôn có ít nhất 1 chi nhánh). */
export class BranchDefaultImmutableError extends DomainError {
  readonly code = 'BRANCH_DEFAULT_IMMUTABLE';

  constructor() {
    super('Không thể ngưng chi nhánh mặc định.');
  }
}

/** Trùng tên với một chi nhánh khác đang hoạt động trong cùng công ty. */
export class BranchDuplicateNameError extends DomainError {
  readonly code = 'BRANCH_DUPLICATE_NAME';

  constructor() {
    super('Đã có chi nhánh khác trùng tên này.');
  }
}
