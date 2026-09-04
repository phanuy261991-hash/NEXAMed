import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  CLINIC_CONFIG_READER_PORT,
  DOCTOR_DIRECTORY_PORT,
  DoctorAvailabilityEmergencyDisabledError,
  DoctorAvailabilityReceptionDisabledError,
  computeShiftSummary,
  getVietnamDateString,
  vietnamDayRange,
  type ClinicConfigReaderPort,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import type {
  DataScope,
  DoctorAvailability,
  DoctorAvailabilityBoardResponse,
  DoctorShiftSummary,
  SetDoctorAvailabilityRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { EncounterRepository } from '../encounter/encounter.repository';
import { PrescriptionRepository } from '../encounter/prescription.repository';
import { DoctorAvailabilityRepository, type DoctorAvailabilityRow } from './doctor-availability.repository';

/**
 * "Tạm nghỉ / Đóng ca" của bác sĩ (đặc tả UX gốc, đã cắt bỏ phần vượt hạ tầng v1 — SMS/Zalo,
 * WebSocket, bảng điện tử gọi số, voice-to-text, dành v2). Trạng thái TÁCH BIỆT hoàn toàn khỏi
 * `encounter.status`, chỉ tác động routing. RBAC (`doctor_availability.update`) chỉ gác "ai được
 * PHÉP THỬ" (bác sĩ personal, lễ tân/clinic_admin global) — 2 công tắc cấu hình
 * (`allowEmergencyEndShift`/`allowReceptionistEndShift`) là lớp gate NGHIỆP VỤ THÊM, kiểm ở đây.
 */
@Injectable()
export class DoctorAvailabilityService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly doctorAvailabilityRepository: DoctorAvailabilityRepository,
    private readonly encounterRepository: EncounterRepository,
    private readonly prescriptionRepository: PrescriptionRepository,
    @Inject(CLINIC_CONFIG_READER_PORT) private readonly clinicConfigReader: ClinicConfigReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** `GET /doctor-availability/policy` — chiếu tối thiểu tự-phục vụ, xem docstring schema ở `@nexamed/shared`. */
  getPolicy(tenantId: string): ReturnType<ClinicConfigReaderPort['getDoctorAvailabilityPolicy']> {
    return this.clinicConfigReader.getDoctorAvailabilityPolicy(tenantId);
  }

  async getTodayBoard(tenantId: string): Promise<DoctorAvailabilityBoardResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.doctorAvailabilityRepository.listTodayForTenant(tx, tenantId);
      return { items: rows.map((row) => this.toDto(row, null)) };
    });
  }

  /**
   * "Đóng ca hôm nay" — popup tổng hợp ca khám trong ngày cho bác sĩ xác nhận trước khi xác nhận
   * đóng ca (mockup duyệt qua nhiều vòng trước khi code). Cùng quy tắc scope với `setStatus()`:
   * scope `personal` chỉ xem được của chính mình (404 nếu khác) — lễ tân/clinic_admin xem được của
   * bác sĩ khác vì họ cũng là người có thể "Đóng ca hộ". Tính theo CẢ NGÀY hôm nay (workDate theo
   * giờ VN), không phải riêng phiên ACTIVE hiện tại — đã hỏi và chốt qua `AskUserQuestion`.
   */
  async getShiftSummary(tenantId: string, actorId: string, dataScope: DataScope, doctorId: string): Promise<DoctorShiftSummary> {
    if (dataScope === 'personal' && doctorId !== actorId) {
      throw new NotFoundException();
    }

    const range = vietnamDayRange(getVietnamDateString());
    const raw = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [encounterCounts, prescriptionCount] = await Promise.all([
        this.encounterRepository.getShiftCounts(tx, tenantId, doctorId, range),
        this.prescriptionRepository.countSignedForDoctorToday(tx, tenantId, doctorId, range),
      ]);
      return { ...encounterCounts, completedCount: encounterCounts.completedDurationsMs.length, prescriptionCount };
    });

    // `DoctorDirectoryPort` tự mở transaction RIÊNG — resolve tên bác sĩ SAU transaction chính,
    // cùng nguyên tắc đã áp dụng toàn dự án (tránh `$transaction` lồng nhau, xem `EncounterService`).
    const names = await this.doctorDirectory.getUserFullNames(tenantId, [doctorId]);

    return { doctorId, doctorName: names.get(doctorId) ?? '', ...computeShiftSummary(raw) };
  }

  /**
   * `targetDoctorId === actorId` (tự thao tác): luôn cho phép đổi ACTIVE/BREAK — riêng ENDED còn
   * cần `allowEmergencyEndShift` BẬT, TRỪ khi `dto.trigger === 'SCHEDULED_END'` (Trường hợp 2,
   * "Hết giờ làm việc" tự nhắc theo giờ đóng cửa phòng khám — luôn được phép, đã hỏi và chốt riêng
   * với chủ dự án, không phụ thuộc công tắc "đóng ca khẩn cấp").
   *
   * `targetDoctorId !== actorId` (lễ tân/clinic_admin thao tác hộ, `dataScope='global'` — scope
   * `personal` ra tới đây tức KHÔNG PHẢI actor sở hữu → 404 theo .claude/docs/multi-tenancy.md,
   * cùng mẫu `rescheduleAppointment()`): cần `allowReceptionistEndShift` BẬT; nếu đổi sang `ENDED`
   * cần THÊM `allowEmergencyEndShift` BẬT (không có "hết giờ hộ" — `trigger` chỉ có ý nghĩa cho
   * nhánh tự thao tác).
   */
  async setStatus(
    tenantId: string,
    actorId: string,
    dataScope: DataScope,
    targetDoctorId: string,
    dto: SetDoctorAvailabilityRequest,
    meta: RequestMeta,
  ): Promise<DoctorAvailability> {
    const isSelf = targetDoctorId === actorId;
    if (dataScope === 'personal' && !isSelf) {
      throw new NotFoundException();
    }

    if (isSelf) {
      const isScheduledEnd = dto.status === 'ENDED' && dto.trigger === 'SCHEDULED_END';
      if (dto.status === 'ENDED' && !isScheduledEnd) {
        const policy = await this.clinicConfigReader.getDoctorAvailabilityPolicy(tenantId);
        if (!policy.allowEmergencyEndShift) {
          throw new DoctorAvailabilityEmergencyDisabledError();
        }
      }
    } else {
      const policy = await this.clinicConfigReader.getDoctorAvailabilityPolicy(tenantId);
      if (!policy.allowReceptionistEndShift) {
        throw new DoctorAvailabilityReceptionDisabledError();
      }
      if (dto.status === 'ENDED' && !policy.allowEmergencyEndShift) {
        throw new DoctorAvailabilityEmergencyDisabledError();
      }
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await this.doctorAvailabilityRepository.upsertToday(tx, tenantId, targetDoctorId, dto.status, dto.reason ?? null, actorId);

      let releasedEncounterCount: number | null = null;
      if (dto.status === 'ENDED') {
        const released = await this.encounterRepository.releaseAllForDoctor(tx, tenantId, targetDoctorId, actorId);
        releasedEncounterCount = released.length;
        for (const item of released) {
          await writeAuditLog(tx, tenantId, {
            actorId,
            action: 'encounter.released',
            entityType: 'encounter',
            entityId: item.id,
            afterJson: { reason: 'doctor_availability_ended', previousStatus: item.previousStatus },
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        }
      }

      const action =
        dto.status === 'ENDED' ? 'doctor_availability.ended' : dto.status === 'BREAK' ? 'doctor_availability.break_started' : 'doctor_availability.resumed';
      await writeAuditLog(tx, tenantId, {
        actorId,
        action,
        entityType: 'doctor_availability',
        entityId: targetDoctorId,
        afterJson: { status: dto.status, reason: dto.reason ?? null, trigger: dto.trigger ?? null, releasedEncounterCount, onBehalfOf: !isSelf },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const row = await this.doctorAvailabilityRepository.findToday(tx, tenantId, targetDoctorId);
      if (!row) {
        // Không thể xảy ra thật — vừa upsert xong trong cùng transaction.
        throw new NotFoundException();
      }
      return this.toDto(row, releasedEncounterCount);
    });
  }

  private toDto(row: DoctorAvailabilityRow, releasedEncounterCount: number | null): DoctorAvailability {
    return {
      doctorId: row.doctorId,
      status: row.status,
      statusChangedAt: row.statusChangedAt.toISOString(),
      reason: row.reason,
      releasedEncounterCount,
    };
  }
}
