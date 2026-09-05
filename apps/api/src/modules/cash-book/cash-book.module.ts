import { forwardRef, Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ClinicModule } from '../clinic/clinic.module';
import { CashierShiftModule } from '../cashier-shift/cashier-shift.module';
import { CashAccountController } from './cash-account.controller';
import { CashAccountService } from './cash-account.service';
import { CashAccountRepository } from './cash-account.repository';
import { CashVoucherController } from './cash-voucher.controller';
import { CashVoucherService } from './cash-voucher.service';
import { CashVoucherRepository } from './cash-voucher.repository';

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1, mockup Artifact duyệt 2026-09-05) — sở hữu bảng
 * `cash_account`/`cash_voucher`. `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT` (resolve tên
 * người lập/duyệt phiếu); `imports: [ClinicModule]` cho `CLINIC_CONFIG_READER_PORT` (công tắc
 * "Phiếu chi phải được duyệt") + `BusinessCodeService` (sinh `voucherNo`).
 *
 * `forwardRef(() => CashierShiftModule)` — vòng phụ thuộc 2 chiều CÓ THẬT giống hệt
 * `BillingModule ⇄ CashierShiftModule` đã có (xem comment ở 2 module đó): `cash-book` cần
 * `CASHIER_SHIFT_READER_PORT` (gắn `cashierShiftId` lúc lập phiếu, kiểm ca còn mở trước khi cho
 * sửa/huỷ); `cashier-shift` cần `CashVoucherRepository` (gộp phiếu ĐÃ DUYỆT vào tổng kết ca).
 *
 * `exports: [CashAccountRepository]` — `BillingModule` dùng để gắn `payment.cashAccountId` lúc
 * thu/hoàn tiền khám (đúng "chia sẻ Repository giữa module trong 1 transaction", #042).
 * `exports: [CashVoucherRepository]` — `CashierShiftModule` dùng trong `computeTotals()`.
 */
@Module({
  imports: [IamModule, ClinicModule, forwardRef(() => CashierShiftModule)],
  controllers: [CashAccountController, CashVoucherController],
  providers: [CashAccountService, CashAccountRepository, CashVoucherService, CashVoucherRepository],
  exports: [CashAccountRepository, CashVoucherRepository],
})
export class CashBookModule {}
