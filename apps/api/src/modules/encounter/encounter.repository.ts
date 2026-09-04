import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Encounter, VitalSign } from '@prisma/client';

export interface CreateEncounterData {
  encounterNo: string;
  patientId: string;
  /** "Hàng đợi ảo" (#064) — `null` khi tạo thẳng vào hàng chờ chung Khoa, chưa gán bác sĩ nào. */
  doctorId: string | null;
  /** "Hàng đợi ảo" (#064) — bắt buộc, đã resolve xong ở `ReceptionService` (từ bác sĩ chọn hoặc Khoa chọn thẳng) trước khi gọi tới đây. */
  departmentId: string;
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
  /** Thu ngân cơ bản (Sprint 5/6) — ý nghĩa thật checkbox "Thanh toán sau" (#080). Mặc định `false`. */
  allowsDeferredPayment?: boolean;
}

export interface EncounterWithPatientContact extends Encounter {
  patient: { patientCode: string; fullName: string; phone: string };
}

export interface EncounterWithPatientDob extends Encounter {
  patient: { dob: Date };
}

export interface EncounterWithInvoiceStatus extends Encounter {
  invoice: { status: 'UNPAID' | 'PAID' } | null;
}

export interface ConsultationPatientFields {
  id: string;
  patientCode: string;
  fullName: string;
  dob: Date;
  gender: string;
  phone: string;
  allergyNote: string | null;
  /** Ghi chú bổ sung tự do (docs/DECISIONS.md #068) — `familyHistory` (text cũ) đã chuyển sang bảng
   * `patient_family_history` có cấu trúc (Sprint 5), đọc qua `PatientFamilyHistoryRepository`, không
   * còn ở đây. */
  personalHistory: string | null;
  /** Cần cho bác sĩ cập nhật lại `patient.allergyNote`/`personalHistory` ngay trong màn khám (optimistic lock). */
  version: number;
}

export interface EncounterWithConsultationPatient extends Encounter {
  patient: ConsultationPatientFields;
  // Sinh hiệu mới nhất của lượt khám này (`take:1`, `orderBy: measuredAt desc`) — đọc qua quan hệ
  // `Encounter.vitalSigns` thay vì gọi thẳng `tx.vitalSign...` (bảng đó do `VitalSignRepository`/
  // module `reception` sở hữu ghi — đọc qua include của aggregate root không phá ranh giới đó,
  // tránh import vòng `EncounterModule` ↔ `ReceptionModule`).
  vitalSigns: VitalSign[];
}

export interface EncounterHistoryRow {
  id: string;
  checkedInAt: Date;
  doctorId: string | null;
  chiefComplaint: string | null;
  diagnoses: { icd10: { nameVi: string } }[];
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
        departmentId: data.departmentId,
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
        allowsDeferredPayment: data.allowsDeferredPayment ?? false,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Encounter | null> {
    return tx.encounter.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /**
   * Thu ngân cơ bản (Sprint 5/6) — kèm trạng thái phiếu thu (nếu có) qua quan hệ sẵn có của chính
   * `Encounter` (không gọi thẳng `tx.invoice...` — bảng đó do `InvoiceRepository`/module `billing`
   * sở hữu ghi, đọc qua include của aggregate root tránh import vòng `EncounterModule` ↔
   * `BillingModule`, cùng lý do đã áp dụng cho `vitalSigns` ở `EncounterWithConsultationPatient`).
   * Dùng riêng cho gate `startConsultation()` — không đổi shape trả về của `findById()` gốc (nhiều
   * caller khác không cần trường này).
   */
  findByIdWithInvoiceStatus(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<EncounterWithInvoiceStatus | null> {
    return tx.encounter.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: { invoice: { select: { status: true } } },
    }) as Promise<EncounterWithInvoiceStatus | null>;
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
   * `patientCode`/`fullName`/`phone` bệnh nhân (encounter không có cột riêng, join `patient`).
   * `doctorId`: lọc theo bác sĩ khi actor chỉ có scope `personal`, cùng khuôn
   * `AppointmentRepository.list()`. `poolDepartmentId` ("Hàng đợi ảo", #064) — CHỈ có tác dụng khi
   * đi CÙNG `doctorId`: đổi từ lọc đơn `doctorId` sang `OR` "của tôi ∪ hàng chờ chung Khoa" (không
   * set `where.doctorId` trực tiếp nữa). Không đổi hành vi khi chỉ có `doctorId` hoặc không có gì
   * (giữ nguyên "Danh sách tiếp nhận" của lễ tân).
   *
   * `requirePaymentCleared` (Thu ngân cơ bản, Sprint 5/6) — cờ TƯỜNG MINH riêng cho "Hàng đợi
   * khám": khi `true`, loại khỏi kết quả các lượt khám còn phiếu thu `UNPAID` và không được phép
   * nợ (`allowsDeferredPayment=false`). "Danh sách tiếp nhận" (lễ tân) KHÔNG set cờ này — vẫn thấy
   * đủ mọi lượt khám kể cả chưa thu tiền để xử lý ở Thu ngân.
   */
  listForDay(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { dayStart: Date; dayEnd: Date; doctorId?: string; poolDepartmentId?: string; requirePaymentCleared?: boolean },
  ): Promise<EncounterWithPatientContact[]> {
    const where: Prisma.EncounterWhereInput = {
      tenantId,
      deletedAt: null,
      status: { in: ['CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED'] },
      checkedInAt: { gte: params.dayStart, lt: params.dayEnd },
    };
    if (params.doctorId && params.poolDepartmentId) {
      where.OR = [{ doctorId: params.doctorId }, { departmentId: params.poolDepartmentId, doctorId: null }];
    } else if (params.doctorId) {
      where.doctorId = params.doctorId;
    }
    if (params.requirePaymentCleared) {
      where.AND = [{ OR: [{ allowsDeferredPayment: true }, { invoice: null }, { invoice: { status: 'PAID' } }] }];
    }
    return tx.encounter.findMany({
      where,
      include: { patient: { select: { patientCode: true, fullName: true, phone: true } } },
      orderBy: [{ checkedInAt: 'asc' }, { id: 'asc' }],
    }) as Promise<EncounterWithPatientContact[]>;
  }

  /** Encounter kèm đủ trường bệnh nhân màn khám cần (S3-05) — join `patient`, cùng khuôn `findByIdWithPatientDob`. */
  findByIdWithConsultationContext(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<EncounterWithConsultationPatient | null> {
    return tx.encounter.findFirst({
      where: { tenantId, id, deletedAt: null },
      include: {
        patient: {
          select: {
            id: true,
            patientCode: true,
            fullName: true,
            dob: true,
            gender: true,
            phone: true,
            allergyNote: true,
            personalHistory: true,
            version: true,
          },
        },
        vitalSigns: { where: { deletedAt: null }, orderBy: { measuredAt: 'desc' }, take: 1 },
      },
    }) as Promise<EncounterWithConsultationPatient | null>;
  }

  /**
   * Tiền sử các lần khám TRƯỚC (ENC-01, không gồm `excludeEncounterId` — chính lượt khám hiện tại),
   * kèm tên chẩn đoán chính (nếu có) qua include lọc `diagnoses` — dùng index
   * `encounter_tenant_id_patient_id_checked_in_at_idx` (đã có từ S3-03, `docs/ERD.md` mục 5).
   */
  listHistoryForPatient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    excludeEncounterId: string,
    limit: number,
  ): Promise<EncounterHistoryRow[]> {
    return tx.encounter.findMany({
      where: { tenantId, patientId, id: { not: excludeEncounterId }, deletedAt: null },
      select: {
        id: true,
        checkedInAt: true,
        doctorId: true,
        chiefComplaint: true,
        diagnoses: {
          where: { type: 'PRIMARY', deletedAt: null },
          select: { icd10: { select: { nameVi: true } } },
        },
      },
      orderBy: { checkedInAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Batch resolve mã lượt khám + bệnh nhân theo id — hạ tầng cho `EncounterReaderPort` (S5-05,
   * ADM-03). Không lọc `deletedAt`/`status` — nhật ký hoạt động phải hiện đúng cả lượt khám đã huỷ.
   */
  findSummariesByIds(
    tx: Prisma.TransactionClient,
    tenantId: string,
    ids: string[],
  ): Promise<{ id: string; encounterNo: string; patientId: string }[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return tx.encounter.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, encounterNo: true, patientId: true },
    });
  }

  /** Toàn bộ id lượt khám thuộc một bệnh nhân — hạ tầng cho `EncounterReaderPort.findIdsByPatientId()`. */
  async findIdsByPatientId(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<string[]> {
    const rows = await tx.encounter.findMany({ where: { tenantId, patientId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * Gộp hồ sơ trùng (S5-06, PAT-04) — chuyển toàn bộ `encounter` của hồ sơ nguồn sang hồ sơ đích.
   * Không đụng `encounterNo`/trạng thái/nội dung lâm sàng nào, chỉ đổi `patientId`.
   */
  async reassignPatientId(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sourcePatientId: string,
    targetPatientId: string,
    actorId: string,
  ): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, patientId: sourcePatientId, deletedAt: null },
      data: { patientId: targetPatientId, updatedBy: actorId },
    });
    return result.count;
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

  /**
   * "Nhận ca" — "Hàng đợi ảo" (#064): pull một ticket đang chờ TRONG hàng chờ chung Khoa
   * (`doctor_id IS NULL`), gán `doctor_id = actorId` VÀ chuyển `CHECKED_IN → IN_CONSULTATION` cùng
   * lúc. Ghi có điều kiện `WHERE doctor_id IS NULL` là cơ chế chống trùng fallback (không
   * WebSocket) — hai bác sĩ bấm gần như đồng thời thì chỉ một `updateMany` khớp điều kiện này,
   * người thua `count=0` (service tự phân biệt "version lệch" và "đã bị người khác nhận" bằng cách
   * đọc lại bản ghi).
   */
  async claimFromPool(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'CHECKED_IN', doctorId: null },
      data: { doctorId: actorId, status: 'IN_CONSULTATION', startedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** "Hoàn tất khám" — `IN_CONSULTATION → COMPLETED`, set `completed_at` (S3-05→07). */
  async complete(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'IN_CONSULTATION' },
      data: { status: 'COMPLETED', completedAt: new Date(), updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * "Khách bỏ về" — `CHECKED_IN → CANCELLED` hoặc (#085) `IN_CONSULTATION → CANCELLED`, bắt buộc
   * lý do. `fromStatus` truyền từ service (đã đọc `existing.status` + `assertEncounterTransition`
   * xác nhận hợp lệ) — ghép vào `WHERE` để atomic đúng cạnh nguồn, cùng khuôn `claimFromPool()`.
   * Không soft-delete (giữ nguyên `deletedAt = null`, cùng cách `appointment.status='CANCELLED'`
   * không soft-delete). `doctorId` GIỮ NGUYÊN (không null hoá) — vết "ai đang khám khi bỏ về".
   */
  async cancel(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    fromStatus: 'CHECKED_IN' | 'IN_CONSULTATION',
    expectedVersion: number,
    cancelReason: string,
    actorId: string,
  ): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: fromStatus },
      data: { status: 'CANCELLED', cancelReason, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * #085 "Trả về hàng chờ" — `IN_CONSULTATION → CHECKED_IN`, nhả `doctorId` về `null` (quay lại
   * hàng chờ chung Khoa cho bác sĩ khác nhận, "Hàng đợi ảo" #064) + xoá `startedAt` (dọn sạch —
   * `claimFromPool()`/`startConsultation()` sẽ set lại đúng thời điểm khi có bác sĩ nhận ca mới,
   * để `startedAt` cũ nằm lại lúc đang CHECKED_IN chỉ gây nhiễu lúc debug).
   */
  async release(tx: Prisma.TransactionClient, tenantId: string, id: string, expectedVersion: number, actorId: string): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'IN_CONSULTATION' },
      data: { status: 'CHECKED_IN', doctorId: null, startedAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /**
   * "Đóng ca" (module `doctor-availability`) — thả HÀNG LOẠT mọi lượt khám `CHECKED_IN`/
   * `IN_CONSULTATION` của một bác sĩ về hàng chờ chung Khoa (`doctorId=null`, giữ nguyên
   * `departmentId`) trong CÙNG 1 câu lệnh, không theo từng id — khác `release()` (1 ca/lần, chỉ
   * nhận từ `IN_CONSULTATION`). `CHECKED_IN` GIỮ NGUYÊN status (chỉ "nhả tay", không đổi trạng
   * thái encounter — cùng khuôn `claimFromPool()` đảo ngược); `IN_CONSULTATION → CHECKED_IN` đúng
   * cạnh `release()` đã có trong state machine (#085), áp dụng hàng loạt. Không kiểm `version` —
   * đây là hành động của actor gọi 1 lần cho TOÀN BỘ hàng đợi của bác sĩ, không có client nào giữ
   * version cũ của từng dòng riêng lẻ (cùng lý do `AppointmentRepository.markNoShow()` bỏ qua
   * version cho job hệ thống). Trả về danh sách `{id, status}` TRƯỚC khi đổi (status cũ) để service
   * ghi đúng 1 dòng `audit_log` `encounter.released` cho mỗi ca, đúng mẫu multi-write của
   * `cancelEncounter()`.
   */
  async releaseAllForDoctor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    actorId: string,
  ): Promise<{ id: string; previousStatus: 'CHECKED_IN' | 'IN_CONSULTATION' }[]> {
    const targets = await tx.encounter.findMany({
      where: { tenantId, doctorId, deletedAt: null, status: { in: ['CHECKED_IN', 'IN_CONSULTATION'] } },
      select: { id: true, status: true },
    });
    if (targets.length === 0) {
      return [];
    }
    await tx.encounter.updateMany({
      where: { tenantId, id: { in: targets.map((t) => t.id) } },
      data: { doctorId: null, startedAt: null, status: 'CHECKED_IN', updatedBy: actorId, version: { increment: 1 } },
    });
    return targets.map((t) => ({ id: t.id, previousStatus: t.status as 'CHECKED_IN' | 'IN_CONSULTATION' }));
  }

  /**
   * "Đóng ca hôm nay" — popup tổng hợp ca khám trong ngày (`DoctorAvailabilityService.getShiftSummary()`).
   * "Đã gọi khám" = `startedAt` rơi trong khoảng ngày truyền vào VÀ `doctorId` hiện đang là bác sĩ
   * này (ca đã "Trả về hàng chờ" thì `doctorId=null`, tự động không còn tính là "của bác sĩ này" —
   * chấp nhận đơn giản hoá này vì đây chỉ là số liệu tổng hợp tham khảo, không phải sổ sách chính
   * thức). "Huỷ khám" dùng CHUNG mốc `startedAt` (không phải lúc huỷ) để nhất quán với "Đã gọi
   * khám" — trả lời đúng câu hỏi "trong số ca tôi gọi hôm nay, bao nhiêu ca bị huỷ", đã chốt với
   * chủ dự án qua `AskUserQuestion` (chỉ tính ca đã gán cho bác sĩ này, không tính ca ở hàng chờ
   * chung Khoa bị huỷ trước khi ai nhận — điều kiện `doctorId` + `startedAt IS NOT NULL` tự loại
   * trừ đúng nhóm đó).
   */
  async getShiftCounts(
    tx: Prisma.TransactionClient,
    tenantId: string,
    doctorId: string,
    range: { startUtc: Date; endUtc: Date },
  ): Promise<{ calledCount: number; cancelledCount: number; completedDurationsMs: number[] }> {
    const [calledCount, cancelledCount, completedRows] = await Promise.all([
      tx.encounter.count({
        where: { tenantId, doctorId, deletedAt: null, startedAt: { gte: range.startUtc, lt: range.endUtc } },
      }),
      tx.encounter.count({
        where: { tenantId, doctorId, deletedAt: null, status: 'CANCELLED', startedAt: { gte: range.startUtc, lt: range.endUtc } },
      }),
      tx.encounter.findMany({
        where: { tenantId, doctorId, deletedAt: null, status: 'COMPLETED', completedAt: { gte: range.startUtc, lt: range.endUtc } },
        select: { startedAt: true, completedAt: true },
      }),
    ]);
    const completedDurationsMs = completedRows
      .filter((row): row is { startedAt: Date; completedAt: Date } => row.startedAt !== null && row.completedAt !== null)
      .map((row) => row.completedAt.getTime() - row.startedAt.getTime());
    return { calledCount, cancelledCount, completedDurationsMs };
  }
}
