import { DomainError } from './domain-error';

/** "Công nợ nhà cung cấp" — Khai nợ đầu kỳ chỉ được 1 lần, chỉ khi NCC CHƯA có bút toán nào (Q7,
 * docs/DECISIONS.md #180/#182). */
export class SupplierDebtOpeningBalanceAlreadyExistsError extends DomainError {
  readonly code = 'SUPPLIER_DEBT_OPENING_BALANCE_ALREADY_EXISTS';

  constructor() {
    super('Nhà cung cấp này đã có bút toán công nợ — không khai nợ đầu kỳ được nữa.');
  }
}
