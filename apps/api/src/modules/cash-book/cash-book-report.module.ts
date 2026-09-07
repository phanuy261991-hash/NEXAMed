import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { CashBookModule } from './cash-book.module';
import { CashBookReportController } from './cash-book-report.controller';
import { CashBookReportService } from './cash-book-report.service';
import { CashBookExportService } from './cash-book-export.service';

/**
 * "Sổ quỹ & Thu chi" Giai đoạn 2 — module RIÊNG (không gộp vào `CashBookModule`) vì
 * `CashBookReportService` cần CẢ `PaymentRepository` (module `billing`) LẪN `CashAccountRepository`/
 * `CashVoucherRepository` (module `cash-book`). `CashBookModule` ⇄ `BillingModule` KHÔNG có vòng
 * phụ thuộc trực tiếp hôm nay (`BillingModule` import `CashBookModule`, chiều ngược lại thì
 * không) — nếu gộp thẳng vào `CashBookModule` sẽ tạo vòng phụ thuộc MỚI cần `forwardRef` ở cả hai
 * phía, không cần thiết khi có thể tách module đọc-only đứng "trên" cả hai. Không `forwardRef` nào
 * ở đây — module này không bị module khác import ngược lại.
 */
@Module({
  imports: [BillingModule, CashBookModule, ReferenceCatalogModule],
  controllers: [CashBookReportController],
  providers: [CashBookReportService, CashBookExportService],
})
export class CashBookReportModule {}
