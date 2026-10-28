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

/** Một dòng "Danh sách tiếp nhận"/"Hàng đợi khám" — chỉ các cột màn hình cần (xem `listForDay`). */
export interface EncounterListRow {
  id: string;
  encounterNo: string;
  appointmentId: string | null;
  patientId: string;
  doctorId: string | null;
  departmentId: string;
  isPriority: boolean;
  chiefComplaint: string | null;
  createdBy: string;
  status: Encounter['status'];
  checkedInAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  insuranceSnapshot: unknown;
  version: number;
  patient: { patientCode: string; fullName: string; phone: string; dob: Date };
  /** "Trung tâm Điều phối Tiếp nhận" — `null` khi lượt khám không có phiếu thu dịch vụ nào. */
  invoice: { status: 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED' } | null;
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
  branchId: string;
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
  create(tx: Prisma.TransactionClient, tenantId: string, branchId: string, actorId: string, data: CreateEncounterData): Promise<Encounter> {
    return tx.encounter.create({
      data: {
        tenantId,
        branchId,
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

  /** Tra theo id TRONG chi nhánh đang làm việc (docs/DECISIONS.md #231) — lượt khám của chi nhánh khác coi như không tồn tại (404). Xem lâm sàng liên chi nhánh đi qua `findByIdWithConsultationContext`. */
  findById(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<Encounter | null> {
    return tx.encounter.findFirst({ where: { tenantId, branchId, id, deletedAt: null } });
  }

  /**
   * Thu ngân cơ bản (Sprint 5/6) — kèm trạng thái phiếu thu (nếu có) qua quan hệ sẵn có của chính
   * `Encounter` (không gọi thẳng `tx.invoice...` — bảng đó do `InvoiceRepository`/module `billing`
   * sở hữu ghi, đọc qua include của aggregate root tránh import vòng `EncounterModule` ↔
   * `BillingModule`, cùng lý do đã áp dụng cho `vitalSigns` ở `EncounterWithConsultationPatient`).
   * Dùng riêng cho gate `startConsultation()` — không đổi shape trả về của `findById()` gốc (nhiều
   * caller khác không cần trường này).
   */
  /**
   * Kho Thuốc GĐ3 (#163) — `Encounter.invoices` nay là quan hệ 1-N (cho phép thêm hoá đơn
   * `invoiceType=DRUG`), lọc tường minh CHỈ `invoiceType='SERVICE'` (partial unique đảm bảo tối đa
   * 1 dòng) rồi map lại thành field `invoice` đơn — giữ nguyên shape trả về cho mọi call site cũ
   * (`existing.invoice?.status`), không phải sửa gì ở tầng Service.
   */
  async findByIdWithInvoiceStatus(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<EncounterWithInvoiceStatus | null> {
    const row = await tx.encounter.findFirst({
      where: { tenantId, branchId, id, deletedAt: null },
      include: { invoices: { where: { invoiceType: 'SERVICE' }, select: { status: true }, take: 1 } },
    });
    if (!row) return null;
    const { invoices, ...rest } = row;
    return { ...rest, invoice: invoices[0] ?? null } as EncounterWithInvoiceStatus;
  }

  /** Tên/mã bệnh nhân của 1 lượt khám — chỉ 2 field, phục vụ `StockIssueService.getDispenseStatus()`
   * hiện khối thông tin đầu dialog "Phát thuốc" (rà soát 22/09/2026, chủ dự án phát hiện dialog
   * không hiện đang phát cho bệnh nhân nào). Đúng tiền lệ chia sẻ `EncounterRepository` đã export
   * sẵn từ `EncounterModule` cho `InventoryModule` (#163/#169), không cần port riêng. */
  async findPatientIdentityById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<{ fullName: string; patientCode: string } | null> {
    const row = await tx.encounter.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: { patient: { select: { fullName: true, patientCode: true } } },
    });
    return row?.patient ?? null;
  }

  /** Kèm `dob` bệnh nhân — phục vụ `evaluateVitalSignWarnings()` (ReceptionService.recordVitalSigns()). */
  findByIdWithPatientDob(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<EncounterWithPatientDob | null> {
    return tx.encounter.findFirst({
      where: { tenantId, branchId, id, deletedAt: null },
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
   *
   * MỘT câu SQL JOIN (bệnh nhân + trạng thái phiếu thu dịch vụ) chỉ lấy đúng cột màn hình cần, thay cho `findMany` + `include` của Prisma: đo thật 22/10/2026 với 1.203 lượt khám/ngày
   * Prisma mất 187 ms, câu SQL này 23 ms (Postgres chạy nhanh, phần chậm là Prisma dựng đối tượng + truy vấn lồng `IN` 1.200 id), `docs/DECISIONS.md` #250. Chỉ tính phiếu thu CHƯA bị xoá mềm (`deleted_at IS NULL`, cũng là điều kiện của chỉ mục từng phần trên `invoice` — thiếu nó Postgres quét tuần tự bảng phiếu thu cho từng lượt khám, đo thật 186 ms thay vì 26 ms).
   */
  async listForDay(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    params: { dayStart: Date; dayEnd: Date; doctorId?: string; poolDepartmentId?: string; requirePaymentCleared?: boolean },
  ): Promise<EncounterListRow[]> {
    const doctorFilter =
      params.doctorId && params.poolDepartmentId
        ? Prisma.sql`AND (e.doctor_id = ${params.doctorId}::uuid OR (e.department_id = ${params.poolDepartmentId}::uuid AND e.doctor_id IS NULL))`
        : params.doctorId
          ? Prisma.sql`AND e.doctor_id = ${params.doctorId}::uuid`
          : Prisma.empty;
    // Kho Thuốc GĐ3 (#163) — lọc tường minh invoice_type='SERVICE' (phiếu thuốc/cận lâm sàng không chặn hàng đợi khám).
    const paymentFilter = params.requirePaymentCleared
      ? Prisma.sql`AND (
          e.allows_deferred_payment
          OR NOT EXISTS (SELECT 1 FROM invoice x WHERE x.tenant_id = e.tenant_id AND x.encounter_id = e.id AND x.invoice_type = 'SERVICE' AND x.deleted_at IS NULL)
          OR EXISTS (SELECT 1 FROM invoice x WHERE x.tenant_id = e.tenant_id AND x.encounter_id = e.id AND x.invoice_type = 'SERVICE' AND x.deleted_at IS NULL AND x.status = 'PAID')
        )`
      : Prisma.empty;

    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        encounter_no: string;
        appointment_id: string | null;
        patient_id: string;
        doctor_id: string | null;
        department_id: string;
        is_priority: boolean;
        chief_complaint: string | null;
        created_by: string;
        status: EncounterListRow['status'];
        checked_in_at: Date;
        started_at: Date | null;
        completed_at: Date | null;
        insurance_snapshot: unknown;
        version: number;
        patient_code: string;
        full_name: string;
        phone: string;
        dob: Date;
        invoice_status: 'UNPAID' | 'PAID' | 'CANCELLED' | 'REFUNDED' | null;
      }>
    >`
      SELECT e.id, e.encounter_no, e.appointment_id, e.patient_id, e.doctor_id, e.department_id, e.is_priority, e.chief_complaint, e.created_by, e.status,
             e.checked_in_at, e.started_at, e.completed_at, e.insurance_snapshot, e.version,
             p.patient_code, p.full_name, p.phone, p.dob, i.status AS invoice_status
        FROM encounter e
        JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
        LEFT JOIN LATERAL (
          SELECT status FROM invoice
           WHERE tenant_id = e.tenant_id AND encounter_id = e.id AND invoice_type = 'SERVICE' AND deleted_at IS NULL
           ORDER BY created_at ASC LIMIT 1
        ) i ON true
       WHERE e.tenant_id = ${tenantId}::uuid
         AND e.branch_id = ${branchId}::uuid
         AND e.deleted_at IS NULL
         AND e.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED')
         AND e.checked_in_at >= ${params.dayStart} AND e.checked_in_at < ${params.dayEnd}
         ${doctorFilter}
         ${paymentFilter}
       ORDER BY e.checked_in_at ASC, e.id ASC
    `;
    return rows.map((r) => ({
      id: r.id,
      encounterNo: r.encounter_no,
      appointmentId: r.appointment_id,
      patientId: r.patient_id,
      doctorId: r.doctor_id,
      departmentId: r.department_id,
      isPriority: r.is_priority,
      chiefComplaint: r.chief_complaint,
      createdBy: r.created_by,
      status: r.status,
      checkedInAt: r.checked_in_at,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      insuranceSnapshot: r.insurance_snapshot,
      version: r.version,
      patient: { patientCode: r.patient_code, fullName: r.full_name, phone: r.phone, dob: r.dob },
      invoice: r.invoice_status ? { status: r.invoice_status } : null,
    }));
  }

  /** Encounter kèm đủ trường bệnh nhân màn khám cần (S3-05) — join `patient`, cùng khuôn `findByIdWithPatientDob`. */
  /**
   * Dữ liệu tối thiểu để dựng thông tin in thêm của đơn thuốc (#242): chi nhánh/bác sĩ để kiểm quyền, ngày sinh, và cân nặng của lần ĐO MỚI NHẤT có ghi cân nặng
   * (sinh hiệu mới nhất có thể không đo cân nặng). Họ tên/CCCD/địa chỉ đọc qua `PatientService.getPatient()` (giải mã đúng một chỗ).
   */
  findForPrescriptionPrint(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    return tx.encounter.findFirst({
      where: { tenantId, id, deletedAt: null },
      select: {
        id: true,
        branchId: true,
        doctorId: true,
        patientId: true,
        insuranceSnapshot: true,
        vitalSigns: { where: { deletedAt: null, weightGram: { not: null } }, orderBy: { measuredAt: 'desc' }, take: 1, select: { weightGram: true } },
      },
    });
  }

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
        branchId: true,
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
   * Tab "Lịch sử khám chữa bệnh" (docs/DECISIONS.md #223) — một trang lượt khám của bệnh nhân, mới nhất trước, phân trang cursor theo `id`. KHÔNG lọc `data_scope=personal`
   * (xem đủ mọi bác sĩ — cùng lý do `findPatientClinicalSummary`, liên tục chăm sóc). `onlyCompleted=false` → mọi trạng thái. Lấy `limit + 1` dòng để biết còn trang sau.
   */
  listHistoryPageForPatient(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    onlyCompleted: boolean,
    cursor: string | undefined,
    limit: number,
  ): Promise<Encounter[]> {
    return tx.encounter.findMany({
      where: { tenantId, patientId, deletedAt: null, ...(onlyCompleted ? { status: 'COMPLETED' as const } : {}) },
      orderBy: [{ checkedInAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: limit + 1,
    });
  }

  /** Số lượt khám cho nút lọc "Đã hoàn tất N / Tất cả N" (#223) — không phụ thuộc bộ lọc đang chọn. */
  async countHistoryForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<{ completed: number; total: number }> {
    const rows = await tx.encounter.groupBy({ by: ['status'], where: { tenantId, patientId, deletedAt: null }, _count: { _all: true } });
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    return { completed: rows.find((r) => r.status === 'COMPLETED')?._count._all ?? 0, total };
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

  /**
   * "Xuất bệnh án PDF" (S6-06, ADM-05) — TOÀN BỘ lượt khám `COMPLETED` của một bệnh nhân, KHÔNG cap
   * (khác `listHistoryForPatient()` giới hạn `CONSULTATION_HISTORY_LIMIT` cho panel tiền sử màn
   * khám). Chỉ lấy `COMPLETED` — lượt khám nháp/huỷ chưa có nội dung lâm sàng đã ký để xuất.
   * `checkedInAt asc` — đọc như nhật ký theo thời gian (cũ → mới), khác `listHistoryForPatient()`
   * (mới → cũ, panel tiền sử ưu tiên hiện gần nhất trước).
   */
  listAllCompletedForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<Encounter[]> {
    return tx.encounter.findMany({
      where: { tenantId, patientId, status: 'COMPLETED', deletedAt: null },
      orderBy: { checkedInAt: 'asc' },
    });
  }

  /** Sinh hiệu MỚI NHẤT của mỗi lượt khám trong danh sách — dùng cho "Xuất bệnh án PDF" (S6-06).
   * Đọc thẳng `tx.vitalSign` (module `encounter` đã đọc bảng này qua include ở nơi khác — xem
   * comment `EncounterWithConsultationPatient`/`findPatientClinicalSummary()`, không phá ranh giới
   * "module `reception` sở hữu GHI bảng `vital_sign`"). */
  async listLatestVitalSignsForEncounters(tx: Prisma.TransactionClient, tenantId: string, encounterIds: string[]): Promise<Map<string, VitalSign>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await tx.vitalSign.findMany({
      where: { tenantId, encounterId: { in: encounterIds }, deletedAt: null },
      orderBy: { measuredAt: 'desc' },
    });
    const result = new Map<string, VitalSign>();
    for (const row of rows) {
      if (!result.has(row.encounterId)) result.set(row.encounterId, row);
    }
    return result;
  }

  /** Toàn bộ id lượt khám thuộc một bệnh nhân — hạ tầng cho `EncounterReaderPort.findIdsByPatientId()`. */
  async findIdsByPatientId(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<string[]> {
    const rows = await tx.encounter.findMany({ where: { tenantId, patientId }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /**
   * Trang "Hồ sơ bệnh nhân" (`GET /encounters/patient-clinical-summary`) — cố ý KHÔNG lọc theo
   * `data_scope` của `encounter.read` (đã chốt: xem đầy đủ mọi bác sĩ, liên tục chăm sóc), gate
   * bằng `patient.read` (global) ở tầng controller. `vitalSigns` KHÔNG lọc theo `status` lượt khám
   * (có thể đã đo dù ca chưa hoàn tất) — chỉ `totalCompletedVisits`/`lastCompletedVisitAt` mới lọc
   * `status='COMPLETED'`. `patientId` của tenant khác tự nhiên trả về rỗng nhờ lọc `tenantId` ở cả
   * 2 nhánh — không cần kiểm tồn tại riêng.
   */
  async findPatientClinicalSummary(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    vitalsLimit: number,
  ): Promise<{ totalCompletedVisits: number; lastCompletedVisitAt: Date | null; vitalSigns: VitalSign[] }> {
    const [totalCompletedVisits, lastCompleted, vitalSigns] = await Promise.all([
      tx.encounter.count({ where: { tenantId, patientId, status: 'COMPLETED', deletedAt: null } }),
      tx.encounter.findFirst({
        where: { tenantId, patientId, status: 'COMPLETED', deletedAt: null },
        orderBy: { checkedInAt: 'desc' },
        select: { checkedInAt: true },
      }),
      tx.vitalSign.findMany({
        where: { tenantId, deletedAt: null, encounter: { patientId, tenantId } },
        orderBy: { measuredAt: 'desc' },
        take: vitalsLimit,
      }),
    ]);
    return { totalCompletedVisits, lastCompletedVisitAt: lastCompleted?.checkedInAt ?? null, vitalSigns };
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
   * "Trung tâm Điều phối Tiếp nhận" — lễ tân đổi bác sĩ/Khoa phụ trách, CHỈ khi còn `CHECKED_IN`
   * (ghép vào `WHERE`, atomic đúng cạnh nguồn — cùng khuôn `cancel()`/`release()`). KHÔNG đổi
   * `status` — thuần đổi `doctorId`/`departmentId`.
   */
  async reassign(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    doctorId: string | null,
    departmentId: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<number> {
    const result = await tx.encounter.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null, status: 'CHECKED_IN' },
      data: { doctorId, departmentId, updatedBy: actorId, version: { increment: 1 } },
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
    branchId: string,
    doctorId: string,
    actorId: string,
  ): Promise<{ id: string; previousStatus: 'CHECKED_IN' | 'IN_CONSULTATION' }[]> {
    const targets = await tx.encounter.findMany({
      where: { tenantId, branchId, doctorId, deletedAt: null, status: { in: ['CHECKED_IN', 'IN_CONSULTATION'] } },
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
    branchId: string,
    doctorId: string,
    range: { startUtc: Date; endUtc: Date },
  ): Promise<{ calledCount: number; cancelledCount: number; completedDurationsMs: number[] }> {
    const [calledCount, cancelledCount, completedRows] = await Promise.all([
      tx.encounter.count({
        where: { tenantId, branchId, doctorId, deletedAt: null, startedAt: { gte: range.startUtc, lt: range.endUtc } },
      }),
      tx.encounter.count({
        where: { tenantId, branchId, doctorId, deletedAt: null, status: 'CANCELLED', startedAt: { gte: range.startUtc, lt: range.endUtc } },
      }),
      tx.encounter.findMany({
        where: { tenantId, branchId, doctorId, deletedAt: null, status: 'COMPLETED', completedAt: { gte: range.startUtc, lt: range.endUtc } },
        select: { startedAt: true, completedAt: true },
      }),
    ]);
    const completedDurationsMs = completedRows
      .filter((row): row is { startedAt: Date; completedAt: Date } => row.startedAt !== null && row.completedAt !== null)
      .map((row) => row.completedAt.getTime() - row.startedAt.getTime());
    return { calledCount, cancelledCount, completedDurationsMs };
  }

  /**
   * "Phiên trước chưa đóng" (mockup 28/10/2026) — lượt khám của các bác sĩ trong `[startUtc, endUtc)` để suy ra ngày
   * nào bác sĩ có làm việc và đếm số liệu từng ngày: lượt đã gọi khám (`startedAt` trong khoảng) HOẶC lượt còn dở đã
   * gán cho bác sĩ (`CHECKED_IN`/`IN_CONSULTATION`, mốc `checkedInAt`). Chỉ chi nhánh đang làm việc.
   */
  async listDoctorEncountersInRange(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    doctorIds: string[],
    range: { startUtc: Date; endUtc: Date },
  ): Promise<{ doctorId: string; status: string; checkedInAt: Date; startedAt: Date | null }[]> {
    if (doctorIds.length === 0) return [];
    const rows = await tx.encounter.findMany({
      where: {
        tenantId,
        branchId,
        doctorId: { in: doctorIds },
        deletedAt: null,
        OR: [
          { startedAt: { gte: range.startUtc, lt: range.endUtc } },
          { status: { in: ['CHECKED_IN', 'IN_CONSULTATION'] }, checkedInAt: { gte: range.startUtc, lt: range.endUtc } },
        ],
      },
      select: { doctorId: true, status: true, checkedInAt: true, startedAt: true },
    });
    return rows.flatMap((row) => (row.doctorId === null ? [] : [{ doctorId: row.doctorId, status: row.status, checkedInAt: row.checkedInAt, startedAt: row.startedAt }]));
  }

  /**
   * Đóng ca NGÀY CŨ — như `releaseAllForDoctor()` nhưng CHỈ trả về hàng chờ chung các lượt còn dở có `checkedInAt`
   * trước `beforeUtc` (đầu ngày hôm nay). Lượt của hôm nay gán cho bác sĩ KHÔNG bị đụng, nếu không đóng ca bù sáng
   * sớm sẽ làm mất "Bệnh nhân của tôi" của chính ngày hôm nay.
   */
  async releaseOpenBeforeForDoctor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    doctorId: string,
    beforeUtc: Date,
    actorId: string,
  ): Promise<{ id: string; previousStatus: 'CHECKED_IN' | 'IN_CONSULTATION' }[]> {
    const targets = await tx.encounter.findMany({
      where: { tenantId, branchId, doctorId, deletedAt: null, status: { in: ['CHECKED_IN', 'IN_CONSULTATION'] }, checkedInAt: { lt: beforeUtc } },
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
}
