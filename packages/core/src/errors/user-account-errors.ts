import { DomainError } from './domain-error';

/** DB trả unique violation trên `(tenant_id, username)` — trùng tên đăng nhập (S2-07, ADM-01). */
export class UserAccountDuplicateUsernameError extends DomainError {
  readonly code = 'USER_ACCOUNT_DUPLICATE_USERNAME';

  constructor() {
    super('Tên đăng nhập này đã được dùng trong phòng khám.');
  }
}
