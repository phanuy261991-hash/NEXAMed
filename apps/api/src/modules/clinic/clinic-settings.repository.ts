import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  businessHoursSchema,
  DEFAULT_OVERDUE_WAIT_WARNING_MINUTES,
  DEFAULT_SLOT_DURATION_MINUTES,
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

  private upsert(tx: Prisma.TransactionClient, tenantId: string, actorId: string, key: string, value: unknown) {
    return tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, valueJson: value as Prisma.InputJsonValue, createdBy: actorId, updatedBy: actorId },
      update: { valueJson: value as Prisma.InputJsonValue, updatedBy: actorId, version: { increment: 1 } },
    });
  }
}
