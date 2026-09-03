import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { BillingModule } from '../billing/billing.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { CashierShiftController } from './cashier-shift.controller';
import { CashierShiftService } from './cashier-shift.service';
import { CashierShiftRepository } from './cashier-shift.repository';

/**
 * "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03) — sở hữu bảng
 * `cashier_shift`. `imports: [BillingModule]` dùng chung `PaymentRepository.listForWindow()` (tổng
 * kết hệ thống); `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT` (resolve tên thu ngân);
 * `imports: [ReferenceCatalogModule]` cho `REFERENCE_CATALOG_READER_PORT` (tên + cờ `countsAsCash`
 * của "Hình thức thanh toán") — đúng "chia sẻ Repository/Port giữa module", `.claude/docs/
 * coding-standards.md` mục "Ranh giới module".
 */
@Module({
  imports: [IamModule, BillingModule, ReferenceCatalogModule],
  controllers: [CashierShiftController],
  providers: [CashierShiftService, CashierShiftRepository],
})
export class CashierShiftModule {}
