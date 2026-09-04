import { forwardRef, Module } from '@nestjs/common';
import { CASHIER_SHIFT_READER_PORT } from '@nexamed/core';
import { IamModule } from '../iam/iam.module';
import { BillingModule } from '../billing/billing.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { ClinicModule } from '../clinic/clinic.module';
import { CashierShiftController } from './cashier-shift.controller';
import { CashierShiftService } from './cashier-shift.service';
import { CashierShiftRepository } from './cashier-shift.repository';

/**
 * "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03) — sở hữu bảng
 * `cashier_shift`. `imports: [BillingModule]` dùng chung `PaymentRepository.listForWindow()`/
 * `.listForShift()` (tổng kết hệ thống); `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT`
 * (resolve tên thu ngân); `imports: [ReferenceCatalogModule]` cho `REFERENCE_CATALOG_READER_PORT`
 * (tên + cờ `countsAsCash` của "Hình thức thanh toán") — đúng "chia sẻ Repository/Port giữa
 * module", `.claude/docs/coding-standards.md` mục "Ranh giới module". `imports: [ClinicModule]`
 * (docs/DECISIONS.md #114) — `CashierShiftRepository` inject `BusinessCodeService` để sinh
 * `shift_no`, `CashierShiftService` đọc `CLINIC_CONFIG_READER_PORT` để rẽ nhánh "Đa thu ngân".
 *
 * `forwardRef(() => BillingModule)` (2026-09-04, "Đa thu ngân") — `BillingModule` giờ CŨNG cần
 * import module này (để `InvoiceService` gắn `cashierShiftId` lúc thu/hoàn tiền qua
 * `CASHIER_SHIFT_READER_PORT`), tạo vòng phụ thuộc 2 chiều CÓ THẬT giữa 2 module (mỗi bên cần dữ
 * liệu của bên kia) — xem comment ở `packages/core/src/ports/cashier-shift-reader.port.ts`.
 * `CashierShiftService` export qua token `CASHIER_SHIFT_READER_PORT` (không export thẳng class,
 * đúng khuôn mọi port khác trong dự án).
 */
@Module({
  imports: [IamModule, forwardRef(() => BillingModule), ReferenceCatalogModule, ClinicModule],
  controllers: [CashierShiftController],
  providers: [CashierShiftService, CashierShiftRepository, { provide: CASHIER_SHIFT_READER_PORT, useExisting: CashierShiftService }],
  exports: [CASHIER_SHIFT_READER_PORT],
})
export class CashierShiftModule {}
