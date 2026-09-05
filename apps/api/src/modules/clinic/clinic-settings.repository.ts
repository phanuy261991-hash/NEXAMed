import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  businessCodeTypeSchema,
  businessHoursSchema,
  type BusinessCodeType,
  DEFAULT_ALLOW_EMERGENCY_END_SHIFT,
  DEFAULT_ALLOW_RECEPTIONIST_END_SHIFT,
  DEFAULT_ALLOW_STAFF_SELF_SCHEDULE_ENABLED,
  DEFAULT_BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_ENABLED,
  DEFAULT_CASHIER_SHIFT_BLIND_CLOSE_ENABLED,
  DEFAULT_CASH_VOUCHER_APPROVAL_ENABLED,
  DEFAULT_CASHIER_SHIFT_MULTI_CASHIER_ENABLED,
  DEFAULT_CASHIER_SHIFT_REQUIRED_ENABLED,
  DEFAULT_NO_SHOW_AUTO_ENABLED,
  DEFAULT_NO_SHOW_THRESHOLD_MINUTES,
  DEFAULT_OVERDUE_WAIT_WARNING_MINUTES,
  DEFAULT_SLOT_DURATION_MINUTES,
  DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS,
  type BusinessHours,
} from '@nexamed/shared';

const BUSINESS_HOURS_KEY = 'business_hours';
const SLOT_DURATION_KEY = 'slot_duration_minutes';
const slotDurationSchema = z.number().int().min(5).max(240);
// Thu ngân cơ bản (Sprint 5/6) — bật/tắt "Thanh toán sau" cấp phòng khám. Mặc định false khi chưa
// cấu hình (chưa từng lưu vào tenant_setting) — an toàn: mọi phòng khám mới bắt buộc thu tiền
// trước khi vào Hàng đợi khám cho tới khi chủ động bật.
const DEFERRED_PAYMENT_ENABLED_KEY = 'deferred_payment_enabled';
const deferredPaymentEnabledSchema = z.boolean();
// Ngưỡng "chờ lâu" ở Hàng đợi khám (2026-08-28, chủ dự án yêu cầu trực tiếp) — mặc định giữ đúng
// giá trị hardcode cũ (30 phút) khi tenant chưa từng cấu hình.
const OVERDUE_WAIT_WARNING_KEY = 'overdue_wait_warning_minutes';
const overdueWaitWarningSchema = z.number().int().min(1).max(240);
// Tự động đánh dấu "Không đến" (S5-07, APP-05, 2026-08-29) — tắt mặc định (an toàn), ngưỡng mặc
// định 60 phút khớp PRD/FE hardcode cũ.
const NO_SHOW_AUTO_ENABLED_KEY = 'no_show_auto_enabled';
const noShowAutoEnabledSchema = z.boolean();
const NO_SHOW_THRESHOLD_KEY = 'no_show_threshold_minutes';
const noShowThresholdSchema = z.number().int().min(1).max(1440);
// "Tạm nghỉ / Đóng ca" của bác sĩ — bật theo mặc định (tính năng chính, không phải ngoại lệ).
const ALLOW_EMERGENCY_END_SHIFT_KEY = 'allow_emergency_end_shift';
const allowEmergencyEndShiftSchema = z.boolean();
// Tắt theo mặc định (an toàn) — lễ tân KHÔNG thao tác hộ trạng thái bác sĩ khác tới khi chủ động bật.
const ALLOW_RECEPTIONIST_END_SHIFT_KEY = 'allow_receptionist_end_shift';
const allowReceptionistEndShiftSchema = z.boolean();
// "Đăng ký ca làm việc" Giai đoạn 2 — tắt theo mặc định (an toàn, giữ nguyên hành vi hiện tại tới
// khi chủ động bật).
const BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_KEY = 'block_booking_outside_work_shift_enabled';
const blockBookingOutsideWorkShiftSchema = z.boolean();
// "Cấu hình chung" (02/09/2026, tiếp sau #104) — bật theo mặc định (giữ nguyên hành vi hiện tại:
// mọi nhân viên tự đăng ký ca) tới khi chủ động tắt.
const ALLOW_STAFF_SELF_SCHEDULE_KEY = 'allow_staff_self_schedule_enabled';
const allowStaffSelfScheduleSchema = z.boolean();
// "Khoá bảng ca" theo tháng (2026-09-03) — số ngày ân hạn sau khi sang tháng mới, mặc định 0 (khoá
// ngay) cho tenant chưa từng cấu hình.
const WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS_KEY = 'work_shift_assignment_lock_grace_days';
const workShiftAssignmentLockGraceDaysSchema = z.number().int().min(0).max(27);
// "Chốt ca" (2026-09-03) — chế độ đối soát Mù/Mở, bật (Mù) theo mặc định cho tenant chưa từng
// cấu hình (khuyến nghị chống gian lận).
const CASHIER_SHIFT_BLIND_CLOSE_KEY = 'cashier_shift_blind_close_enabled';
const cashierShiftBlindCloseSchema = z.boolean();
// "Yêu cầu mở ca trước khi thu tiền" (2026-09-04) — bật theo mặc định (giữ đúng hành vi hiện tại:
// "Thu tiền" chặn tới khi có ca thu ngân đang mở) cho tenant chưa từng cấu hình.
const CASHIER_SHIFT_REQUIRED_KEY = 'cashier_shift_required_enabled';
const cashierShiftRequiredSchema = z.boolean();
// "Đa thu ngân" (2026-09-04) — tắt theo mặc định (an toàn — giữ nguyên "1 két dùng chung toàn
// tenant" tới khi chủ động bật).
const CASHIER_SHIFT_MULTI_CASHIER_KEY = 'cashier_shift_multi_cashier_enabled';
const cashierShiftMultiCashierSchema = z.boolean();
// "Thu chi tại quầy" (Sổ quỹ & Thu chi GĐ1) — tắt theo mặc định (thu ngân tự lập phiếu, hiệu lực
// ngay) cho tenant chưa từng cấu hình.
const CASH_VOUCHER_APPROVAL_ENABLED_KEY = 'cash_voucher_approval_enabled';
const cashVoucherApprovalEnabledSchema = z.boolean();
// "Cấu hình mẫu mã phát sinh" (docs/DECISIONS.md #114, 2026-09-03) — 1 object JSON duy nhất,
// khoá theo loại mã (7 loại), chỉ chứa entry của loại mã ĐÃ được tenant chủ động sửa (loại chưa
// đụng tới thì KHÔNG có key — service tự áp mặc định khớp hành vi cũ, xem `BusinessCodeService`).
const BUSINESS_CODE_TEMPLATES_KEY = 'business_code_templates';
export interface BusinessCodeTemplateEntry {
  template: string;
  counterDigits: number;
  startingValue: number;
}
const businessCodeTemplateEntrySchema = z.object({
  template: z.string().min(1),
  counterDigits: z.number().int().min(1).max(9),
  startingValue: z.number().int().positive(),
});
const businessCodeTemplatesConfigSchema = z.record(businessCodeTypeSchema, businessCodeTemplateEntrySchema);
type BusinessCodeTemplatesConfig = Partial<Record<BusinessCodeType, BusinessCodeTemplateEntry>>;

/**
 * Đọc/ghi `tenant_setting` cho hai key cấu hình phòng khám (S2-07, ADM-02) — cùng mẫu
 * `BreakGlassRepository.getDurationMinutes()` (đọc trực tiếp key, parse Zod, fallback mặc định
 * nếu chưa cấu hình hoặc dữ liệu hỏng). Mỗi cấu hình một key riêng, không gộp vào một object lớn
 * — đúng cách `tenant_setting` đã dùng cho `break_glass_duration_minutes`.
 */
@Injectable()
export class ClinicSettingsRepository {
  async getBusinessHours(tx: Prisma.TransactionClient, tenantId: string): Promise<BusinessHours | null> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: BUSINESS_HOURS_KEY } });
    if (!setting) {
      return null;
    }
    const parsed = businessHoursSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : null;
  }

  async getSlotDurationMinutes(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: SLOT_DURATION_KEY } });
    if (!setting) {
      return DEFAULT_SLOT_DURATION_MINUTES;
    }
    const parsed = slotDurationSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_SLOT_DURATION_MINUTES;
  }

  async getDeferredPaymentEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: DEFERRED_PAYMENT_ENABLED_KEY } });
    if (!setting) {
      return false;
    }
    const parsed = deferredPaymentEnabledSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : false;
  }

  async getOverdueWaitWarningMinutes(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: OVERDUE_WAIT_WARNING_KEY } });
    if (!setting) {
      return DEFAULT_OVERDUE_WAIT_WARNING_MINUTES;
    }
    const parsed = overdueWaitWarningSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_OVERDUE_WAIT_WARNING_MINUTES;
  }

  async getNoShowAutoEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: NO_SHOW_AUTO_ENABLED_KEY } });
    if (!setting) {
      return DEFAULT_NO_SHOW_AUTO_ENABLED;
    }
    const parsed = noShowAutoEnabledSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_NO_SHOW_AUTO_ENABLED;
  }

  async getNoShowThresholdMinutes(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: NO_SHOW_THRESHOLD_KEY } });
    if (!setting) {
      return DEFAULT_NO_SHOW_THRESHOLD_MINUTES;
    }
    const parsed = noShowThresholdSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_NO_SHOW_THRESHOLD_MINUTES;
  }

  async getAllowEmergencyEndShift(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: ALLOW_EMERGENCY_END_SHIFT_KEY } });
    if (!setting) {
      return DEFAULT_ALLOW_EMERGENCY_END_SHIFT;
    }
    const parsed = allowEmergencyEndShiftSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_ALLOW_EMERGENCY_END_SHIFT;
  }

  async getAllowReceptionistEndShift(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: ALLOW_RECEPTIONIST_END_SHIFT_KEY } });
    if (!setting) {
      return DEFAULT_ALLOW_RECEPTIONIST_END_SHIFT;
    }
    const parsed = allowReceptionistEndShiftSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_ALLOW_RECEPTIONIST_END_SHIFT;
  }

  async getBlockBookingOutsideWorkShiftEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_KEY } });
    if (!setting) {
      return DEFAULT_BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_ENABLED;
    }
    const parsed = blockBookingOutsideWorkShiftSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_ENABLED;
  }

  upsertBlockBookingOutsideWorkShiftEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_KEY, value);
  }

  async getAllowStaffSelfScheduleEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: ALLOW_STAFF_SELF_SCHEDULE_KEY } });
    if (!setting) {
      return DEFAULT_ALLOW_STAFF_SELF_SCHEDULE_ENABLED;
    }
    const parsed = allowStaffSelfScheduleSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_ALLOW_STAFF_SELF_SCHEDULE_ENABLED;
  }

  upsertAllowStaffSelfScheduleEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, ALLOW_STAFF_SELF_SCHEDULE_KEY, value);
  }

  async getWorkShiftAssignmentLockGraceDays(tx: Prisma.TransactionClient, tenantId: string): Promise<number> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS_KEY } });
    if (!setting) {
      return DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS;
    }
    const parsed = workShiftAssignmentLockGraceDaysSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS;
  }

  upsertWorkShiftAssignmentLockGraceDays(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: number) {
    return this.upsert(tx, tenantId, actorId, WORK_SHIFT_ASSIGNMENT_LOCK_GRACE_DAYS_KEY, value);
  }

  async getCashierShiftBlindCloseEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: CASHIER_SHIFT_BLIND_CLOSE_KEY } });
    if (!setting) {
      return DEFAULT_CASHIER_SHIFT_BLIND_CLOSE_ENABLED;
    }
    const parsed = cashierShiftBlindCloseSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_CASHIER_SHIFT_BLIND_CLOSE_ENABLED;
  }

  upsertCashierShiftBlindCloseEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, CASHIER_SHIFT_BLIND_CLOSE_KEY, value);
  }

  async getCashierShiftRequiredEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: CASHIER_SHIFT_REQUIRED_KEY } });
    if (!setting) {
      return DEFAULT_CASHIER_SHIFT_REQUIRED_ENABLED;
    }
    const parsed = cashierShiftRequiredSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_CASHIER_SHIFT_REQUIRED_ENABLED;
  }

  upsertCashierShiftRequiredEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, CASHIER_SHIFT_REQUIRED_KEY, value);
  }

  async getCashierShiftMultiCashierEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: CASHIER_SHIFT_MULTI_CASHIER_KEY } });
    if (!setting) {
      return DEFAULT_CASHIER_SHIFT_MULTI_CASHIER_ENABLED;
    }
    const parsed = cashierShiftMultiCashierSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_CASHIER_SHIFT_MULTI_CASHIER_ENABLED;
  }

  upsertCashierShiftMultiCashierEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, CASHIER_SHIFT_MULTI_CASHIER_KEY, value);
  }

  async getCashVoucherApprovalEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: CASH_VOUCHER_APPROVAL_ENABLED_KEY } });
    if (!setting) {
      return DEFAULT_CASH_VOUCHER_APPROVAL_ENABLED;
    }
    const parsed = cashVoucherApprovalEnabledSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : DEFAULT_CASH_VOUCHER_APPROVAL_ENABLED;
  }

  upsertCashVoucherApprovalEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, CASH_VOUCHER_APPROVAL_ENABLED_KEY, value);
  }

  /** Chỉ trả entry của loại mã tenant ĐÃ chủ động cấu hình — loại mã vắng mặt nghĩa là "dùng mặc
   * định", `BusinessCodeService` tự áp giá trị mặc định (không lưu ở đây). */
  async getBusinessCodeTemplatesConfig(tx: Prisma.TransactionClient, tenantId: string): Promise<BusinessCodeTemplatesConfig> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: BUSINESS_CODE_TEMPLATES_KEY } });
    if (!setting) {
      return {};
    }
    const parsed = businessCodeTemplatesConfigSchema.safeParse(setting.valueJson);
    return parsed.success ? parsed.data : {};
  }

  /** Merge đúng 1 loại mã vào object JSON chung, không đụng các loại khác — đọc-sửa-ghi trong
   * CÙNG transaction của caller (không race vì `tenant_setting` không có ai ghi đồng thời khoá
   * mã ngay tại chỗ này — khác `code_sequence` cần atomic thật). */
  async upsertBusinessCodeTemplateEntry(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    codeType: BusinessCodeType,
    entry: BusinessCodeTemplateEntry,
  ): Promise<void> {
    const current = await this.getBusinessCodeTemplatesConfig(tx, tenantId);
    const next: BusinessCodeTemplatesConfig = { ...current, [codeType]: entry };
    await this.upsert(tx, tenantId, actorId, BUSINESS_CODE_TEMPLATES_KEY, next);
  }

  upsertAllowEmergencyEndShift(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, ALLOW_EMERGENCY_END_SHIFT_KEY, value);
  }

  upsertAllowReceptionistEndShift(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, ALLOW_RECEPTIONIST_END_SHIFT_KEY, value);
  }

  upsertBusinessHours(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: BusinessHours) {
    return this.upsert(tx, tenantId, actorId, BUSINESS_HOURS_KEY, value);
  }

  upsertSlotDurationMinutes(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: number) {
    return this.upsert(tx, tenantId, actorId, SLOT_DURATION_KEY, value);
  }

  upsertDeferredPaymentEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, DEFERRED_PAYMENT_ENABLED_KEY, value);
  }

  upsertOverdueWaitWarningMinutes(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: number) {
    return this.upsert(tx, tenantId, actorId, OVERDUE_WAIT_WARNING_KEY, value);
  }

  upsertNoShowAutoEnabled(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: boolean) {
    return this.upsert(tx, tenantId, actorId, NO_SHOW_AUTO_ENABLED_KEY, value);
  }

  upsertNoShowThresholdMinutes(tx: Prisma.TransactionClient, tenantId: string, actorId: string, value: number) {
    return this.upsert(tx, tenantId, actorId, NO_SHOW_THRESHOLD_KEY, value);
  }

  private upsert(tx: Prisma.TransactionClient, tenantId: string, actorId: string, key: string, value: unknown) {
    return tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, valueJson: value as Prisma.InputJsonValue, createdBy: actorId, updatedBy: actorId },
      update: { valueJson: value as Prisma.InputJsonValue, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
