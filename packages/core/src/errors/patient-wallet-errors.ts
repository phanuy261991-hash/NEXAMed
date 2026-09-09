import { DomainError } from './domain-error';

/**
 * Ví tạm ứng — số dư không đủ để thanh toán trọn phiếu thu VÀ tenant chưa bật "Cho phép thanh toán
 * hỗn hợp" (`tenant_setting.wallet_mixed_payment_enabled`), hoặc bật rồi mà client không gửi kèm
 * phương thức cho phần còn lại. Mang theo số liệu để FE hiện đúng khối "Cần thu tối thiểu" (màn
 * Chi tiết thanh toán) mà không phải gọi lại API tính riêng.
 */
export class WalletInsufficientBalanceError extends DomainError {
  readonly code = 'WALLET_INSUFFICIENT_BALANCE';

  constructor(
    readonly balance: number,
    readonly due: number,
    readonly shortfall: number,
  ) {
    super('Số dư ví tạm ứng không đủ để thanh toán phiếu thu này.');
  }
}

/** Ví đã "Tất toán" (khoá) — không nạp/trừ được nữa, phải tạo lại từ đầu (nạp lần đầu tự mở ví mới). */
export class WalletClosedError extends DomainError {
  readonly code = 'WALLET_CLOSED';

  constructor() {
    super('Ví tạm ứng của bệnh nhân này đã khoá — không nạp/trừ tiền được nữa.');
  }
}
