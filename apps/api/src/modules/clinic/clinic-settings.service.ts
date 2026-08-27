import { Injectable } from '@nestjs/common';
import type { ClinicConfigReaderPort } from '@nexamed/core';
import type { ClinicSettings, UpdateClinicSettingsRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { ClinicSettingsRepository } from './clinic-settings.repository';
import { DoctorRoomSessionRepository } from './doctor-room-session.repository';

/**
 * Cấu hình phòng khám (S2-07, ADM-02 — trừ mẫu in) — module `clinic`. Cũng hiện thực
 * `ClinicConfigReaderPort` (S2-09, `getScheduleConfig` gọi thẳng `getSettings` đã có — cùng shape,
 * chỉ đổi tên phương thức cho khớp interface port; `getTodayDoctorRoomAssignments`, #054, cùng lý
 * do — bridge duy nhất để `AppointmentModule` đọc dữ liệu thuộc `clinic` mà không tự import thẳng
 * module này, .claude/docs/coding-standards.md).
 */
@Injectable()
export class ClinicSettingsService implements ClinicConfigReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly clinicSettingsRepository: ClinicSettingsRepository,
    private readonly doctorRoomSessionRepository: DoctorRoomSessionRepository,
  ) {}

  async getSettings(tenantId: string): Promise<ClinicSettings> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [businessHours, slotDurationMinutes, deferredPaymentEnabled] = await Promise.all([
        this.clinicSettingsRepository.getBusinessHours(tx, tenantId),
        this.clinicSettingsRepository.getSlotDurationMinutes(tx, tenantId),
        this.clinicSettingsRepository.getDeferredPaymentEnabled(tx, tenantId),
      ]);
      return { businessHours, slotDurationMinutes, deferredPaymentEnabled };
    });
  }

  /** `ClinicConfigReaderPort` — xem comment ở khai báo class. */
  getScheduleConfig(tenantId: string): ReturnType<ClinicConfigReaderPort['getScheduleConfig']> {
    return this.getSettings(tenantId);
  }

  /** `ClinicConfigReaderPort` (#054) — xem comment ở khai báo class. */
  getTodayDoctorRoomAssignments(tenantId: string): ReturnType<ClinicConfigReaderPort['getTodayDoctorRoomAssignments']> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.doctorRoomSessionRepository.listActiveForTenantToday(tx, tenantId));
  }

  /** `ClinicConfigReaderPort` (Thu ngân cơ bản, Sprint 5/6) — xem comment ở khai báo class. */
  getDeferredPaymentEnabled(tenantId: string): ReturnType<ClinicConfigReaderPort['getDeferredPaymentEnabled']> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.clinicSettingsRepository.getDeferredPaymentEnabled(tx, tenantId));
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
      if (dto.deferredPaymentEnabled !== undefined) {
        await this.clinicSettingsRepository.upsertDeferredPaymentEnabled(tx, tenantId, actorId, dto.deferredPaymentEnabled);
      }

      if (dto.businessHours !== undefined || dto.slotDurationMinutes !== undefined || dto.deferredPaymentEnabled !== undefined) {
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

      const [businessHours, slotDurationMinutes, deferredPaymentEnabled] = await Promise.all([
        this.clinicSettingsRepository.getBusinessHours(tx, tenantId),
        this.clinicSettingsRepository.getSlotDurationMinutes(tx, tenantId),
        this.clinicSettingsRepository.getDeferredPaymentEnabled(tx, tenantId),
      ]);
      return { businessHours, slotDurationMinutes, deferredPaymentEnabled };
    });
  }
}
