import { forwardRef, Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';
import { ClinicModule } from '../clinic/clinic.module';
import { CashierShiftModule } from '../cashier-shift/cashier-shift.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';

/**
 * Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — sở hữu bảng `invoice`/`invoice_line`/`payment`.
 * `exports: [InvoiceRepository]` — `ReceptionModule` dùng chung trong transaction check-in/tiếp
 * nhận trực tiếp để tự động tạo phiếu thu (đúng "chia sẻ Repository giữa module trong 1
 * transaction", `docs/DECISIONS.md` #042). `exports: [PaymentRepository]` (2026-09-03, mới) —
 * `CashierShiftModule` dùng chung `listForWindow()`/`listForShift()` để tính "Tổng kết hệ thống"
 * (đối soát tiền mặt), cùng lý do.
 * `imports: [ClinicModule]` (docs/DECISIONS.md #114) — `InvoiceRepository` inject
 * `BusinessCodeService` để sinh `invoice_no` thay `formatDisplayCode` gọi trực tiếp trước đây.
 * `imports: [forwardRef(() => CashierShiftModule)]` (2026-09-04, "Đa thu ngân") — `InvoiceService`
 * đọc `CASHIER_SHIFT_READER_PORT` để gắn `cashierShiftId` lúc thu/hoàn tiền; `forwardRef` bắt buộc
 * vì `CashierShiftModule` đã `imports: [BillingModule]` sẵn — vòng phụ thuộc 2 chiều có thật, xem
 * comment ở `cashier-shift.module.ts`/`packages/core/src/ports/cashier-shift-reader.port.ts`.
 * `imports: [CashBookModule]` (2026-09-05, "Thu chi tại quầy" GĐ1) — `InvoiceService` dùng chung
 * `CashAccountRepository` để gắn `payment.cashAccountId` lúc thu/hoàn tiền (đúng "chia sẻ
 * Repository giữa module trong 1 transaction", #042) — KHÔNG cần `forwardRef` (`cash-book` không
 * phụ thuộc ngược `billing`). `imports: [ReferenceCatalogModule]` — `InvoiceService` đọc
 * `REFERENCE_CATALOG_READER_PORT` để biết `countsAsCash` của phương thức thanh toán.
 */
@Module({
  imports: [ClinicModule, forwardRef(() => CashierShiftModule), CashBookModule, ReferenceCatalogModule],
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceRepository, PaymentRepository],
  exports: [InvoiceRepository, PaymentRepository],
})
export class BillingModule {}
