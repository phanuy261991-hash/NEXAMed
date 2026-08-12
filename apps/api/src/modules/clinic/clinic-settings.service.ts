import { Injectable } from '@nestjs/common';
import type { ClinicConfigReaderPort } from '@nexamed/core';
import type { ClinicSettings, UpdateClinicSettingsRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicSettingsRepository } from './clinic-settings.repository';

/**
 * Cấu hình phòng khám (S2-07, ADM-02 — trừ mẫu in) — module `clinic`. Cũng hiện thực
 * `ClinicConfigReaderPort` (S2-09, `getScheduleConfig` gọi thẳng `getSettings` đã có — cùng shape,
 * chỉ đổi tên phương thức cho khớp interface port) để `AppointmentModule` đọc giờ làm việc/độ dài
 * slot mà không tự import thẳng module `clinic` (.claude/docs/coding-standards.md).
 */
@Injectable()
export class ClinicSettingsService implements ClinicConfigReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly clinicSettingsRepository: ClinicSettingsRepository,
  ) {}

  async getSettings(tenantId: string): Promise<ClinicSettings> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [businessHours, slotDurationMinutes] = await Promise.all([
        this.clinicSettingsRepository.getBusinessHours(tx, tenantId),
        this.clinicSettingsRepository.getSlotDurationMinutes(tx, tenantId),
      ]);
      return { businessHours, slotDurationMinutes };
    });
  }

  /** `ClinicConfigReaderPort` — xem comment ở khai báo class. */
  getScheduleConfig(tenantId: string): ReturnType<ClinicConfigReaderPort['getScheduleConfig']> {
    return this.getSettings(tenantId);
  }

  async updateSettings(
    tenantId: string,
    actorId: string,
    dto: UpdateClinicSettingsRequest,
    meta: RequestMeta,
  ): Promise<ClinicSettings> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (dto.businessHours !== undefined) {
        await this.clinicSettingsRepository.upsertBusinessHours(tx, tenantId, actorId, dto.businessHours);
      }
      if (dto.slotDurationMinutes !== undefined) {
        await this.clinicSettingsRepository.upsertSlotDurationMinutes(tx, tenantId, actorId, dto.slotDurationMinutes);
      }

      if (dto.businessHours !== undefined || dto.slotDurationMinutes !== undefined) {
        await writeAuditLog(tx, tenantId, {
          actorId,
          action: 'clinic_settings.updated',
          entityType: 'tenant_setting',
          entityId: tenantId,
          afterJson: { ...dto },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      const [businessHours, slotDurationMinutes] = await Promise.all([
        this.clinicSettingsRepository.getBusinessHours(tx, tenantId),
        this.clinicSettingsRepository.getSlotDurationMinutes(tx, tenantId),
      ]);
      return { businessHours, slotDurationMinutes };
    });
  }
}
