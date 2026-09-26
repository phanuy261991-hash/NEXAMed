import { forwardRef, Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ClinicModule } from '../clinic/clinic.module';
import { DrugModule } from '../drug/drug.module';
import { CashierShiftModule } from '../cashier-shift/cashier-shift.module';
import { CashBookModule } from '../cash-book/cash-book.module';
import { InventoryModule } from '../inventory/inventory.module';
import { SupplierDebtController } from './supplier-debt.controller';
import { SupplierDebtService } from './supplier-debt.service';
import { SupplierDebtAccountRepository } from './supplier-debt-account.repository';
import { SupplierDebtEntryRepository } from './supplier-debt-entry.repository';
import { SupplierDebtAdjustmentRepository } from './supplier-debt-adjustment.repository';
import { SupplierDebtReconciliationRepository } from './supplier-debt-reconciliation.repository';

/**
 * "Công nợ nhà cung cấp" — Phần A "Nền sổ công nợ" (docs/DECISIONS.md #180/#182). Sở hữu 2 bảng mới
 * `supplier_debt_account`/`supplier_debt_entry`.
 *
 * `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT` (resolve tên người ghi sổ, tab "Sổ công nợ");
 * `imports: [ClinicModule]` cho `BusinessCodeService` (sinh mã phiếu "Trả ngay") + `CLINIC_CONFIG_
 * READER_PORT` (công tắc "Phiếu chi phải được duyệt").
 *
 * `forwardRef(() => DrugModule)` cho `SupplierRepository` (find NCC/list toàn bộ NCC cho `GET
 * /supplier-debt/summaries`) và `forwardRef(() => CashierShiftModule)` cho `CASHIER_SHIFT_READER_
 * PORT` (gắn `cashierShiftId` lúc tạo phiếu chi "Trả ngay") — CẢ HAI phải bọc `forwardRef()` dù bản
 * thân `DrugModule`/`CashierShiftModule` không cần gì NGƯỢC LẠI từ `supplier-debt`: `DrugModule ⇄
 * InventoryModule` (forwardRef có sẵn) VÀ `CashierShiftModule ⇄ CashBookModule/BillingModule`
 * (forwardRef có sẵn) đã là 2 vòng phụ thuộc THẬT từ trước; `InventoryModule` giờ import thẳng
 * `SupplierDebtModule` (bên dưới) và `CashBookModule ⇄ SupplierDebtModule` (ngay dưới) khiến
 * `supplier-debt` bị "kéo vào" GIỮA cả 2 vòng đó — require() vòng qua nhiều file (không chỉ 2 file
 * trực tiếp) khiến Node trả về `module.exports` CHƯA ĐẦY ĐỦ nếu không bọc `forwardRef()`, dù xét
 * riêng `supplier-debt → drug`/`supplier-debt → cashier-shift` không phải vòng 2 chiều "trực tiếp".
 * Xác nhận đúng bằng lỗi thật lúc test: "The module at index [3] of the InventoryModule imports
 * array is undefined" khi 2 dòng import này còn là import thường.
 *
 * `forwardRef(() => CashBookModule)` — vòng phụ thuộc 2 chiều CÓ THẬT: `supplier-debt` cần
 * `CashVoucherRepository`/`CashAccountRepository` (tạo phiếu chi "Trả ngay" TRONG CÙNG transaction
 * với Duyệt phiếu nhập); `cash-book` cần `SupplierDebtService` (hook `recordVoucherPosted()`/
 * `reverseVoucherPayment()` gọi từ `CashVoucherService.approve()`/`voidVoucher()` khi voucher có
 * `supplierId`) — đúng tiền lệ `cashier-shift ⇄ cash-book` (tiêm thẳng Service qua `forwardRef`,
 * KHÔNG dùng port trung gian vì hook này PHẢI chạy trong CÙNG transaction với thao tác gốc, khác
 * mọi port đọc hiện có trong dự án vốn "tự mở transaction đọc riêng").
 *
 * CỐ Ý KHÔNG import `InventoryModule` (đọc `stock_receipt` để hiện `receiptNo`/`occurredAt` ở tab
 * "Phiếu nhập") — tránh biến `inventory ⇄ supplier-debt` thành vòng phụ thuộc 2 chiều CHỈ để phục vụ
 * hiển thị. `GET /supplier-debt/:supplierId/receipts` chỉ trả số liệu công nợ (không receiptNo); web
 * tự ghép với `GET /inventory/receipts?supplierId=` (đã thêm filter) theo `stockReceiptId`. Xem
 * đánh đổi tương tự (FIFO thuần, không target đúng phiếu) ở comment đầu `supplier-debt.service.ts`.
 *
 * `exports: [SupplierDebtService]` — `InventoryModule` (`StockReceiptService.approve()`) import
 * THƯỜNG (một chiều, `supplier-debt` không cần gì từ `inventory`) TỚI PHẦN D (xem dưới).
 *
 * Phần D "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182, ĐẢO NGƯỢC quyết định "CỐ Ý KHÔNG import
 * InventoryModule" đã ghi ở trên — lý do cũ chỉ áp dụng cho nhu cầu HIỂN THỊ (join `receiptNo`), còn
 * đây là nhu cầu NGHIỆP VỤ THẬT: `SupplierDebtService.approveAdjustment()` (duyệt "Đề nghị huỷ") gọi
 * `StockReceiptService`/`StockIssueService.voidPostedForAdjustment()` TRONG CÙNG transaction để thực
 * thi "Huỷ chứng từ" hộ người không có quyền duyệt phiếu gốc — không thể qua port (port trong dự án
 * này LUÔN tự mở transaction đọc riêng, phá vỡ tính nguyên tử). `forwardRef(() => InventoryModule)`
 * MỚI thêm — giờ `inventory ⇄ supplier-debt` là vòng phụ thuộc 2 chiều THẬT ở mức Service (đã bọc
 * `@Inject(forwardRef())` ở cả 2 đầu injection, xem `stock-receipt.service.ts`/`stock-issue.service.ts`/
 * `supplier-debt.service.ts`).
 */
@Module({
  imports: [
    IamModule,
    ClinicModule,
    forwardRef(() => DrugModule),
    forwardRef(() => CashierShiftModule),
    forwardRef(() => CashBookModule),
    forwardRef(() => InventoryModule),
  ],
  controllers: [SupplierDebtController],
  providers: [
    SupplierDebtService,
    SupplierDebtAccountRepository,
    SupplierDebtEntryRepository,
    SupplierDebtAdjustmentRepository,
    SupplierDebtReconciliationRepository,
  ],
  exports: [SupplierDebtService],
})
export class SupplierDebtModule {}
