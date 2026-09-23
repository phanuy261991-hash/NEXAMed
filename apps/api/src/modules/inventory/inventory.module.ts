import { forwardRef, Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ClinicModule } from '../clinic/clinic.module';
import { DrugModule } from '../drug/drug.module';
import { BillingModule } from '../billing/billing.module';
import { EncounterModule } from '../encounter/encounter.module';
import { StockReceiptController } from './stock-receipt.controller';
import { StockReceiptService } from './stock-receipt.service';
import { StockReceiptRepository } from './stock-receipt.repository';
import { StockLedgerController } from './stock-ledger.controller';
import { StockLedgerService } from './stock-ledger.service';
import { StockLedgerRepository } from './stock-ledger.repository';
import { StockBalanceController } from './stock-balance.controller';
import { StockBalanceService } from './stock-balance.service';
import { StockBalanceRepository } from './stock-balance.repository';
import { InventoryBatchRepository } from './inventory-batch.repository';
import { StockIssueController } from './stock-issue.controller';
import { StockIssueService } from './stock-issue.service';
import { StockIssueRepository } from './stock-issue.repository';
import { StockCountController } from './stock-count.controller';
import { StockCountService } from './stock-count.service';
import { StockCountRepository } from './stock-count.repository';
import { StockTransferController } from './stock-transfer.controller';
import { StockTransferService } from './stock-transfer.service';
import { StockTransferRepository } from './stock-transfer.repository';

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 2 (Nhập kho & tồn theo lô, docs/DECISIONS.md #146). Module
 * RIÊNG (không nhét vào `DrugModule`) — nghiệp vụ vận hành kho khác nghiệp vụ sửa danh mục thuốc,
 * dù cùng chạm dữ liệu `drug`/`warehouse`/`supplier` (đọc qua Repository export từ `DrugModule`
 * trong CÙNG transaction, đúng tiền lệ "chia sẻ Repository giữa module", #042).
 *
 * `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT` (resolve tên người tạo/duyệt phiếu);
 * `imports: [ClinicModule]` cho `BusinessCodeService` (sinh `receiptNo`/`issueNo`) và
 * `CLINIC_CONFIG_READER_PORT` (`StockBalanceService` đọc `expiryWarningDays`; `StockIssueService`
 * đọc `pharmacySeparateInvoiceEnabled`, GĐ3); `imports: [DrugModule]` cho
 * `DrugRepository`/`WarehouseRepository`/`SupplierRepository`.
 *
 * Giai đoạn 3 (Xuất kho theo đơn, #163) thêm: `imports: [BillingModule]` — `StockIssueService`
 * dùng chung `InvoiceRepository` để gắn tiền vào hoá đơn trong CÙNG transaction (đúng "chia sẻ
 * Repository giữa module", #042). `imports: [EncounterModule]` — `StockIssueService` dùng chung
 * `PrescriptionRepository` để đọc/validate đơn thuốc lúc "Phát thuốc" (import THƯỜNG, không
 * `forwardRef` — chiều phụ thuộc chỉ MỘT phía kể từ khi gỡ "Tự động phát thuốc lúc ký đơn", #165;
 * trước đó có vòng 2 chiều thật vì `EncounterService` gọi ngược `StockIssueService`).
 *
 * `DrugModule` đổi sang `forwardRef()` (21/09/2026) — `DrugModule` giờ CŨNG import ngược lại
 * `InventoryModule` (đọc `StockBalanceRepository` cho guard chặn đổi `isBatchManaged` khi còn tồn),
 * vòng phụ thuộc 2 chiều CÓ THẬT. `exports: [StockBalanceRepository]` phục vụ đúng chiều đọc đó.
 *
 * Giai đoạn 4, phần "Kiểm kê" (docs/DECISIONS.md #170) thêm `StockCountController/Service/
 * Repository` — CÙNG module (không tách riêng, đúng tinh thần "vận hành kho" chung với
 * `stock_receipt`/`stock_issue`). `StockCountService` gọi trực tiếp `StockReceiptService`/
 * `StockIssueService` (method mới `createCountSurplusReceipt()`/`createCountShortageIssue()`) —
 * chiều phụ thuộc MỘT phía trong nội bộ module, không cần khai thêm gì ở `imports`.
 *
 * Giai đoạn 4, phần "Điều chuyển kho" (docs/DECISIONS.md #170) thêm `StockTransferController/
 * Service/Repository` — cùng chỗ, cùng cách gọi `StockReceiptService.createTransferInReceipt()`/
 * `StockIssueService.createTransferOutIssue()` (method mới, đối xứng `createCountSurplusReceipt()`/
 * `createCountShortageIssue()` ở trên) — không cần khai thêm gì ở `imports`.
 */
@Module({
  imports: [IamModule, ClinicModule, forwardRef(() => DrugModule), BillingModule, EncounterModule],
  controllers: [StockReceiptController, StockLedgerController, StockBalanceController, StockIssueController, StockCountController, StockTransferController],
  providers: [
    StockReceiptService,
    StockReceiptRepository,
    StockLedgerService,
    StockLedgerRepository,
    StockBalanceService,
    StockBalanceRepository,
    InventoryBatchRepository,
    StockIssueService,
    StockIssueRepository,
    StockCountService,
    StockCountRepository,
    StockTransferService,
    StockTransferRepository,
  ],
  exports: [StockBalanceRepository],
})
export class InventoryModule {}
