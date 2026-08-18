import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Encounter } from '@prisma/client';

export interface CreateEncounterData {
  encounterNo: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  checkedInAt: Date;
  chiefComplaint: string | null;
  insuranceSnapshot: Prisma.InputJsonValue;
  /** "Tiếp nhận bệnh nhân" (tạo trực tiếp) — xem `registerReceptionRequestSchema`. `null`/`undefined` ở luồng check-in từ lịch hẹn. */
  patientSourceCode?: string | null;
  examTypeCode?: string | null;
  examTypeName?: string | null;
  examTypePrice?: bigint | null;
  /** Thiết kế lại "Tiếp nhận bệnh nhân" (mockup đã duyệt) — xem `packages/shared/src/encounter.ts` (`intakeExtendedFieldsSchema`). */
  receptionTypeCode?: string | null;
  examFormCode?: string | null;
  isPriority?: boolean;
  priorityReasonCode?: string | null;
  priceTypeCode?: string | null;
  examTypeUnit?: string | null;
  serviceQuantity?: number;
}

export interface EncounterWithPatientContact extends Encounter {
  patient: { fullName: string; phone: string };
}

export interface EncounterWithPatientDob extends Encounter {
  patient: { dob: Date };
}

/** Chỗ DUY NHẤT gọi Prisma cho bảng `encounter` — theo .claude/docs/coding-standards.md. Export
 * qua `EncounterModule` để `ReceptionModule` dùng chung trong cùng transaction check-in (xem
 * docs/DECISIONS.md — quyết định kiến trúc chia sẻ Repository giữa 2 module thay vì Service). */
@Injectable()
export class EncounterRepository {
  /** Luôn tạo thẳng ở `CHECKED_IN` — v1 không có luồng nào tạo encounter ở `SCHEDULED` (xem comment trong schema.prisma). */
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateEncounterData): Promise<Encounter> {
    return tx.encounter.create({
      data: {
        tenantId,
        patientId: data.patientId,
        doctorId: data.doctorId,
        appointmentId: data.appointmentId,
        encounterNo: data.encounterNo,
        status: 'CHECKED_IN',
        checkedInAt: data.checkedInAt,
        chiefComplaint: data.chiefComplaint,
        insuranceSnapshot: data.insuranceSnapshot,
        patientSourceCode: data.patientSourceCode ?? null,
        examTypeCode: data.examTypeCode ?? null,
        examTypeName: data.examTypeName ?? null,
        examTypePrice: data.examTypePrice ?? null,
        receptionTypeCode: data.receptionTypeCode ?? null,
        examFormCode: data.examFormCode ?? null,
        isPriority: data.isPriority ?? false,
        priorityReasonCode: data.priorityReasonCode ?? null,
        priceTypeCode: data.priceTypeCode ?? null,
        examTypeUnit: data.examTypeUnit ?? null,
        serviceQuantity: data.serviceQuantity ?? 1,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Encounter | null> {
    return tx.encounter.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /** Kèm `dob` bệnh nhân — phục vụ `evaluateVitalSignWarnings()` (ReceptionService.recordVitalSigns()). */
  findByIdWithPatientDob(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<EncounterWithPatientDob | null> {
    return tx.encounter.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { patient: { select: { dob: true } } },
    }) as Promise<EncounterWithPatientDob | null>;
  }

  /**
   * Danh sách Tiếp nhận — MỌI encounter theo dõi được trong ngày (`CHECKED_IN`/`IN_CONSULTATION`/
   * `COMPLETED`/`CANCELLED` — đủ 4, không chỉ "đang dở dang"), lọc theo `checked_in_at` trong biên
   * ngày (`dayStart`/`dayEnd`, quy đổi giờ Việt Nam ở service qua `vietnamDayRange()`). Kèm
   * `fullName`/`phone` bệnh nhân (encounter không có cột riêng, join `patient`). `doctorId`: lọc
   * theo bác sĩ khi actor chỉ có scope `personal`, cùng khuôn `AppointmentRepository.list()`.
   */
  listForDay(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { dayStart: Date; dayEnd: Date; doctorId?: string },
  ): Promise<EncounterWithPatientContact[]> {
    const where: Prisma.EncounterWhereInput = {
      tenantId,
      deletedAt: null,
      status: { in: ['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED'] },
      checkedInAt: { gte: params.dayStart, lt: params.dayEnd },
    };
    if (params.doctorId) {
      where.doctorId = params.doctorId;
    }
    return tx.encounter.findMany({
      where,
      include: { patient: { select: { fullName: true, phone: true } } },
      orderBy: [{ checkedInAt: 'asc' }, { id: 'asc' }],
    }) as Promise<EncounterWithPatientContact[]>;
  }

  /**
   * "Bắt đầu khám" — `CHECKED_IN → IN_CONSULTATION`, set `started_at`. `updateMany` + kiểm
   * `count` (không phải `update`) — cần ghép `version`/`status` vào `WHERE` cho atomic, cùng
   * khuôn `AppointmentRepository.cancel()`.
   */
  async startConsultation(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'CHECKED_IN' },
      data: { status: 'IN_CONSULTATION', startedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** "Bỏ về" — `CHECKED_IN → CANCELLED`, bắt buộc lý do. Không soft-delete (giữ nguyên `deletedAt = null`, cùng cách `appointment.status='CANCELLED'` không soft-delete). */
  async cancel(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    cancelReason: string,
    actorId: string,
  ): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'CHECKED_IN' },
      data: { status: 'CANCELLED', cancelReason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
