import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  businessHoursSchema,
  DEFAULT_ALLOW_EMERGENCY_END_SHIFT,
  DEFAULT_ALLOW_RECEPTIONIST_END_SHIFT,
  DEFAULT_ALLOW_STAFF_SELF_SCHEDULE_ENABLED,
  DEFAULT_BLOCK_BOOKING_OUTSIDE_WORK_SHIFT_ENABLED,
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
