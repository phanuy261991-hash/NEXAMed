import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ClinicModule } from '../clinic/clinic.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { CashierShiftModule } from '../cashier-shift/cashier-shift.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { PatientModule } from '../patient/patient.module';
import { PatientWalletController } from './patient-wallet.controller';
import { PatientWalletService } from './patient-wallet.service';
import { PatientWalletRepository } from './patient-wallet.repository';

/**
 * "Ví tạm ứng" — sở hữu bảng `patient_wallet`/`wallet_transaction`. KHÔNG import `BillingModule`/
 * `ReceptionModule` — 2 module đó gọi VÀO đây (một chiều: Billing→Wallet, Reception→Wallet), tự
 * đánh dấu `invoice` đã thu bằng `InvoiceRepository`/`PaymentRepository` của CHÍNH chúng sau khi
 * gọi `deduct()`/`tryGetActiveWallet()` — module này không cần biết gì về `invoice`/`payment`.
 *
 * `imports: [CashBookModule]` — dùng `CashVoucherRepository`/`CashAccountRepository` để tạo phiếu
 * thu/chi thật lúc Nạp/Tất toán (tiền THẬT vào/ra két, tự động vào Chốt ca/Sổ quỹ/Báo cáo dòng
 * tiền). `imports: [ClinicModule]` — `BusinessCodeService` sinh `voucherNo` (2 codeType mới
 * `WALLET_TOPUP`/`WALLET_SETTLEMENT`). `imports: [CashierShiftModule]` — `CASHIER_SHIFT_READER_PORT`
 * gắn `cashierShiftId` lúc lập phiếu, cùng khuôn `BillingModule`/`CashBookModule`. KHÔNG cần
 * `forwardRef` — không có module nào trong 3 module trên import ngược lại `PatientWalletModule`.
 * `imports: [ReferenceCatalogModule]` — `REFERENCE_CATALOG_READER_PORT` biết `countsAsCash` của
 * phương thức thanh toán. `imports: [PatientModule]` — `PatientRepository` (resolve tên/mã bệnh
 * nhân cho mô tả phiếu quỹ + trang "Ví tạm ứng" tổng hợp). `imports: [IamModule]` —
 * `DOCTOR_DIRECTORY_PORT` resolve tên người thực hiện ở lịch sử giao dịch (dù `Global`, import
 * tường minh cho rõ ràng, cùng khuôn `CashBookModule`).
 */
@Module({
  imports: [IamModule, ClinicModule, CashBookModule, CashierShiftModule, ReferenceCatalogModule, PatientModule],
  controllers: [PatientWalletController],
  providers: [PatientWalletService, PatientWalletRepository],
  exports: [PatientWalletService],
})
export class PatientWalletModule {}
