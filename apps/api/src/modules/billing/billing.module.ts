import { Module } from '@nestjs/common';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

/**
 * Thu ngân cơ bản (Sprint 5/6, BIL-01→04) — sở hữu bảng `invoice`/`invoice_line`/`payment`.
 * `exports: [InvoiceRepository]` — `ReceptionModule` dùng chung trong transaction check-in/tiếp
 * nhận trực tiếp để tự động tạo phiếu thu (đúng "chia sẻ Repository giữa module trong 1
 * transaction", `docs/DECISIONS.md` #042). `exports: [PaymentRepository]` (2026-09-03, mới) —
 * `CashierShiftModule` dùng chung `listForWindow()` để tính "Tổng kết hệ thống" (đối soát tiền
 * mặt), cùng lý do.
 */
@Module({
  controllers: [InvoiceController],
  providers: [InvoiceService, InvoiceRepository, PaymentRepository],
  exports: [InvoiceRepository, PaymentRepository],
})
export class BillingModule {}
