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
 * Repository giữa module", #042; `BillingModule` không import ngược `InventoryModule` nên KHÔNG
 * cần `forwardRef`). `imports: [forwardRef(() => EncounterModule)]` — `StockIssueService` dùng
 * chung `PrescriptionRepository` để đọc/validate đơn thuốc; vòng phụ thuộc 2 CHIỀU CÓ THẬT với
 * `EncounterModule` (`EncounterService.signPrescription()` gọi ngược lại `StockIssueService` để tự
 * phát thuốc khi `autoDispenseOnSignEnabled`) — `forwardRef` bắt buộc cả hai phía, cùng mẫu
 * `CashierShiftModule` ↔ `BillingModule`. `exports: [StockIssueService]` cho `EncounterModule`.
 */
@Module({
  imports: [IamModule, ClinicModule, DrugModule, BillingModule, forwardRef(() => EncounterModule)],
  controllers: [StockReceiptController, StockLedgerController, StockBalanceController, StockIssueController],
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
  ],
  exports: [StockIssueService],
})
export class InventoryModule {}
