import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LONG_WAIT_MINUTES, WAIT_BUCKETS, type DiscountType, type HourCountRow, type VisitBookInvoice, type WaitHourRow } from '@nexamed/core';

/**
 * Truy vấn của nhóm báo cáo "Khám bệnh và vận hành" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231;
 * phạm vi do `ReportBranchScopeService` giải quyết ở service). Số đếm gom theo nhóm ở đây, việc ghép thành bản đồ nhiệt/khung giờ/tỉ lệ ở `@nexamed/core`. Giờ theo lịch Việt Nam
 * (UTC+7, không có giờ mùa hè) bằng `+ interval '7 hours'` như các báo cáo khác.
 */

const VN_LOCAL = (column: string) => Prisma.raw(`((${column} AT TIME ZONE 'UTC') + interval '7 hours')`);
const COUNTED_STATUSES = Prisma.sql`e.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')`;
const WAIT_STATUSES = Prisma.sql`e.status::text IN ('IN_CONSULTATION', 'COMPLETED')`;
const WAIT_MINUTES = Prisma.sql`(EXTRACT(EPOCH FROM (e.started_at - e.checked_in_at)) / 60.0)`;

/** Mốc ngày (`YYYY-MM-DD`) và khoảng thời gian UTC nửa mở của một kỳ. */
export interface OpsPeriod {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface WaitGroupRaw {
  doctorId: string | null;
  date: string;
  count: number;
  sumMinutes: number;
  over30Count: number;
  maxMinutes: number;
}

export interface CancelRaw {
  status: string;
  doctorId: string | null;
  date: string;
  count: number;
}

export interface FollowUpRaw {
  doctorId: string | null;
  notReturning: boolean;
  returned: boolean;
  past: boolean;
  count: number;
}

export interface BookingSourceRaw {
  source: string;
  status: string;
  count: number;
}

export interface VisitBookFilter extends OpsPeriod {
  doctorId: string | null;
  /** Tiền tố mã ICD-10 chẩn đoán chính, đã viết hoa. */
  icd10Prefix: string | null;
  /** Tên đã bỏ dấu + viết thường, SĐT hoặc mã BN. */
  searchNormalized: string | null;
}

export interface VisitBookCursor {
  /** `YYYY-MM-DDTHH:MM:SS.ffffff` UTC — giữ đủ micro giây để khoá phân trang không lệch. */
  at: string;
  id: string;
}

export interface VisitBookRaw {
  encounterId: string;
  encounterNo: string;
  atText: string;
  visitDate: string;
  branchId: string;
  doctorId: string | null;
  patientId: string;
  patientCode: string;
  patientName: string;
  dob: string;
  gender: string;
}

@Injectable()
export class OperationsReportRepository {
  /** Số lượt khám đã tiếp nhận theo (thứ, giờ) tiếp nhận. */
  async countByWeekdayAndHour(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<HourCountRow[]> {
    const local = VN_LOCAL('e.checked_in_at');
    const rows = await tx.$queryRaw<Array<{ dow: number; hour: number; n: number }>>`
      SELECT EXTRACT(ISODOW FROM ${local})::int AS dow, EXTRACT(HOUR FROM ${local})::int AS hour, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY 1, 2`;
    return rows.map((r) => ({ isoDow: r.dow, hour: r.hour, count: r.n }));
  }

  /** Thời gian chờ (tiếp nhận → vào khám) gom theo giờ tiếp nhận và mốc phân bố; chỉ lượt có cả hai mốc giờ và không âm. */
  async waitByHourAndBucket(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<WaitHourRow[]> {
    const local = VN_LOCAL('e.checked_in_at');
    const [b0, b1, b2, b3] = WAIT_BUCKETS.map((b) => b.upTo ?? 0);
    const rows = await tx.$queryRaw<Array<{ hour: number; bucket: number; n: number; sum_min: number }>>`
      SELECT EXTRACT(HOUR FROM ${local})::int AS hour,
             (CASE WHEN ${WAIT_MINUTES} < ${b0} THEN 0 WHEN ${WAIT_MINUTES} < ${b1} THEN 1 WHEN ${WAIT_MINUTES} < ${b2} THEN 2 WHEN ${WAIT_MINUTES} < ${b3} THEN 3 ELSE 4 END)::int AS bucket,
             COUNT(*)::int AS n, COALESCE(SUM(${WAIT_MINUTES}), 0)::float8 AS sum_min
        FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${WAIT_STATUSES}
         AND e.started_at IS NOT NULL AND e.started_at >= e.checked_in_at AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY 1, 2`;
    return rows.map((r) => ({ hour: r.hour, bucket: r.bucket, count: r.n, sumMinutes: r.sum_min }));
  }

  /** Thời gian chờ gom theo (bác sĩ, ngày tiếp nhận) — web ghép thành bảng theo bác sĩ và theo ngày. */
  async waitByDoctorAndDay(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<WaitGroupRaw[]> {
    const local = VN_LOCAL('e.checked_in_at');
    const rows = await tx.$queryRaw<Array<{ doctor_id: string | null; d: string; n: number; sum_min: number; over: number; max_min: number }>>`
      SELECT e.doctor_id, to_char(${local}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n, COALESCE(SUM(${WAIT_MINUTES}), 0)::float8 AS sum_min,
             (COUNT(*) FILTER (WHERE ${WAIT_MINUTES} >= ${LONG_WAIT_MINUTES}))::int AS over, COALESCE(MAX(${WAIT_MINUTES}), 0)::float8 AS max_min
        FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${WAIT_STATUSES}
         AND e.started_at IS NOT NULL AND e.started_at >= e.checked_in_at AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY 1, 2`;
    return rows.map((r) => ({ doctorId: r.doctor_id, date: r.d, count: r.n, sumMinutes: r.sum_min, over30Count: r.over, maxMinutes: r.max_min }));
  }

  /** Lượt khám theo (trạng thái, bác sĩ, ngày tiếp nhận) — mọi trạng thái, để có cả mẫu số của tỉ lệ huỷ. */
  async encountersByStatusDoctorDay(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<CancelRaw[]> {
    const local = VN_LOCAL('e.checked_in_at');
    const rows = await tx.$queryRaw<Array<{ status: string; doctor_id: string | null; d: string; n: number }>>`
      SELECT e.status::text AS status, e.doctor_id, to_char(${local}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ status: r.status, doctorId: r.doctor_id, date: r.d, count: r.n }));
  }

  /** Lịch hẹn theo (trạng thái, bác sĩ, ngày hẹn). */
  async appointmentsByStatusDoctorDay(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<CancelRaw[]> {
    const local = VN_LOCAL('a.scheduled_at');
    const rows = await tx.$queryRaw<Array<{ status: string; doctor_id: string | null; d: string; n: number }>>`
      SELECT a.status::text AS status, a.doctor_id, to_char(${local}, 'YYYY-MM-DD') AS d, COUNT(*)::int AS n
        FROM appointment a
       WHERE a.tenant_id = ${p.tenantId}::uuid AND a.branch_id = ANY(${p.branchIds}::uuid[]) AND a.deleted_at IS NULL AND a.scheduled_at >= ${p.start} AND a.scheduled_at < ${p.end}
       GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ status: r.status, doctorId: r.doctor_id, date: r.d, count: r.n }));
  }

  /** Lý do huỷ lượt khám và lịch hẹn (rỗng = không ghi lý do). */
  async cancelReasons(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<{ encounters: Array<{ reason: string; count: number }>; appointments: Array<{ reason: string; count: number }> }> {
    const [encounters, appointments] = await Promise.all([
      tx.$queryRaw<Array<{ reason: string; n: number }>>`
        SELECT COALESCE(btrim(e.cancel_reason), '') AS reason, COUNT(*)::int AS n
          FROM encounter e
         WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'CANCELLED'
           AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
         GROUP BY 1`,
      tx.$queryRaw<Array<{ reason: string; n: number }>>`
        SELECT COALESCE(btrim(a.cancel_reason), '') AS reason, COUNT(*)::int AS n
          FROM appointment a
         WHERE a.tenant_id = ${p.tenantId}::uuid AND a.branch_id = ANY(${p.branchIds}::uuid[]) AND a.deleted_at IS NULL AND a.status::text = 'CANCELLED'
           AND a.scheduled_at >= ${p.start} AND a.scheduled_at < ${p.end}
         GROUP BY 1`,
    ]);
    return { encounters: encounters.map((r) => ({ reason: r.reason, count: r.n })), appointments: appointments.map((r) => ({ reason: r.reason, count: r.n })) };
  }

  /**
   * Hẹn tái khám có ngày hẹn trong `[from, to]` (kế hoạch ĐÃ KÝ còn hiệu lực, hướng "Hẹn tái khám", lượt khám gốc đã hoàn tất), gom theo (bác sĩ, đã ghi "không tái khám", đã quay lại,
   * ngày hẹn đã qua). "Đã quay lại" = bệnh nhân có lượt khám đã tiếp nhận SAU lượt gốc — cùng quy tắc trang "Hẹn tái khám" (#285).
   */
  async followUps(tx: Prisma.TransactionClient, p: Pick<OpsPeriod, 'tenantId' | 'branchIds'> & { from: string; to: string; today: string }): Promise<FollowUpRaw[]> {
    const rows = await tx.$queryRaw<Array<{ doctor_id: string | null; not_returning: boolean; returned: boolean; past: boolean; n: number }>>`
      WITH f AS (
        SELECT p.follow_up_date AS d, e.id AS eid, e.patient_id, e.checked_in_at AS at, e.doctor_id,
               EXISTS (SELECT 1 FROM follow_up_reminder r WHERE r.tenant_id = e.tenant_id AND r.encounter_id = e.id AND r.result = 'NOT_RETURNING' AND r.deleted_at IS NULL) AS not_returning
          FROM encounter_treatment_plan p
          JOIN encounter e ON e.tenant_id = p.tenant_id AND e.id = p.encounter_id
         WHERE p.tenant_id = ${p.tenantId}::uuid AND p.deleted_at IS NULL AND p.signed_at IS NOT NULL
           AND 'FOLLOW_UP' = ANY(p.directions::text[]) AND p.follow_up_date IS NOT NULL
           AND p.follow_up_date >= ${p.from}::date AND p.follow_up_date <= ${p.to}::date
           AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
      )
      SELECT f.doctor_id, f.not_returning, (d < ${p.today}::date) AS past,
             EXISTS (
               SELECT 1 FROM encounter n
                WHERE n.tenant_id = ${p.tenantId}::uuid AND n.patient_id = f.patient_id AND n.deleted_at IS NULL AND n.id <> f.eid
                  AND n.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED') AND n.checked_in_at > f.at
             ) AS returned,
             COUNT(*)::int AS n
        FROM f
       GROUP BY 1, 2, 3, 4`;
    return rows.map((r) => ({ doctorId: r.doctor_id, notReturning: r.not_returning, returned: r.returned, past: r.past, count: r.n }));
  }

  /** Số lần nhắc tái khám trong kỳ theo kết quả; lượt khám gốc thuộc phạm vi chi nhánh. */
  async followUpRemindersByResult(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<Array<{ result: string; count: number }>> {
    const rows = await tx.$queryRaw<Array<{ result: string; n: number }>>`
      SELECT r.result::text AS result, COUNT(*)::int AS n
        FROM follow_up_reminder r
        JOIN encounter e ON e.tenant_id = r.tenant_id AND e.id = r.encounter_id
       WHERE r.tenant_id = ${p.tenantId}::uuid AND r.deleted_at IS NULL AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL
         AND r.reminded_at >= ${p.start} AND r.reminded_at < ${p.end}
       GROUP BY 1`;
    return rows.map((r) => ({ result: r.result, count: r.n }));
  }

  /** Lịch hẹn theo (nguồn, trạng thái) với ngày hẹn trong kỳ. */
  async appointmentsBySourceAndStatus(tx: Prisma.TransactionClient, p: OpsPeriod): Promise<BookingSourceRaw[]> {
    const rows = await tx.$queryRaw<Array<{ source: string; status: string; n: number }>>`
      SELECT a.source::text AS source, a.status::text AS status, COUNT(*)::int AS n
        FROM appointment a
       WHERE a.tenant_id = ${p.tenantId}::uuid AND a.branch_id = ANY(${p.branchIds}::uuid[]) AND a.deleted_at IS NULL AND a.scheduled_at >= ${p.start} AND a.scheduled_at < ${p.end}
       GROUP BY 1, 2`;
    return rows.map((r) => ({ source: r.source, status: r.status, count: r.n }));
  }

  /** Tên bác sĩ theo id (hiển thị `display_name` nếu có). */
  async doctorNames(tx: Prisma.TransactionClient, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, COALESCE(display_name, full_name) AS name FROM user_account WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids as string[]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ---- Sổ khám bệnh ----

  private visitBookWhere(f: VisitBookFilter): Prisma.Sql {
    const doctor = f.doctorId ? Prisma.sql`AND e.doctor_id = ${f.doctorId}::uuid` : Prisma.empty;
    const icd = f.icd10Prefix
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM diagnosis d WHERE d.tenant_id = e.tenant_id AND d.encounter_id = e.id AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY' AND upper(d.icd10_code) LIKE ${f.icd10Prefix + '%'})`
      : Prisma.empty;
    const search = f.searchNormalized
      ? Prisma.sql`AND (pt.search_key LIKE ${'%' + f.searchNormalized + '%'} OR pt.phone LIKE ${f.searchNormalized + '%'} OR lower(pt.patient_code) LIKE ${'%' + f.searchNormalized + '%'})`
      : Prisma.empty;
    return Prisma.sql`
      e.tenant_id = ${f.tenantId}::uuid AND e.branch_id = ANY(${f.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
      AND e.checked_in_at >= ${f.start} AND e.checked_in_at < ${f.end} ${doctor} ${icd} ${search}`;
  }

  async countVisitBook(tx: Prisma.TransactionClient, f: VisitBookFilter): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM encounter e JOIN patient pt ON pt.tenant_id = e.tenant_id AND pt.id = e.patient_id WHERE ${this.visitBookWhere(f)}`;
    return rows[0]?.n ?? 0;
  }

  /** Một trang sổ khám, mới nhất trước; khoá phân trang `(giờ tiếp nhận, id)`. Lấy `limit + 1` dòng để biết còn trang sau. */
  async listVisitBook(tx: Prisma.TransactionClient, f: VisitBookFilter, cursor: VisitBookCursor | null, limit: number): Promise<VisitBookRaw[]> {
    const after = cursor ? Prisma.sql`AND (e.checked_in_at, e.id) < (${cursor.at}::timestamp AT TIME ZONE 'UTC', ${cursor.id}::uuid)` : Prisma.empty;
    const local = VN_LOCAL('e.checked_in_at');
    const rows = await tx.$queryRaw<
      Array<{ id: string; encounter_no: string; at_text: string; d: string; branch_id: string; doctor_id: string | null; patient_id: string; patient_code: string; full_name: string; dob: string; gender: string }>
    >`
      SELECT e.id, e.encounter_no, to_char(e.checked_in_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS at_text, to_char(${local}, 'YYYY-MM-DD') AS d,
             e.branch_id, e.doctor_id, e.patient_id, pt.patient_code, pt.full_name, to_char(pt.dob, 'YYYY-MM-DD') AS dob, pt.gender
        FROM encounter e JOIN patient pt ON pt.tenant_id = e.tenant_id AND pt.id = e.patient_id
       WHERE ${this.visitBookWhere(f)} ${after}
       ORDER BY e.checked_in_at DESC, e.id DESC
       LIMIT ${limit + 1}`;
    return rows.map((r) => ({
      encounterId: r.id,
      encounterNo: r.encounter_no,
      atText: r.at_text,
      visitDate: r.d,
      branchId: r.branch_id,
      doctorId: r.doctor_id,
      patientId: r.patient_id,
      patientCode: r.patient_code,
      patientName: r.full_name,
      dob: r.dob,
      gender: r.gender,
    }));
  }

  /** Chẩn đoán chính (còn hiệu lực) của từng lượt khám — mã và tên theo danh mục ICD-10 của Bộ Y tế. */
  async primaryDiagnoses(tx: Prisma.TransactionClient, tenantId: string, encounterIds: readonly string[]): Promise<Map<string, { code: string; name: string }>> {
    if (encounterIds.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ encounter_id: string; code: string; name: string }>>`
      SELECT DISTINCT ON (d.encounter_id) d.encounter_id, d.icd10_code AS code, c.name_vi AS name
        FROM diagnosis d JOIN icd10_catalog c ON c.code = d.icd10_code
       WHERE d.tenant_id = ${tenantId}::uuid AND d.encounter_id = ANY(${encounterIds as string[]}::uuid[]) AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY'
       ORDER BY d.encounter_id, d.created_at DESC`;
    return new Map(rows.map((r) => [r.encounter_id, { code: r.code, name: r.name }]));
  }

  /** Phiếu CHƯA HUỶ (chưa thu + đã thu) của các lượt khám, kèm dòng — để tính thành tiền và danh sách dịch vụ ở `@nexamed/core`. */
  async invoicesByEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterIds: readonly string[]): Promise<Map<string, VisitBookInvoice[]>> {
    const result = new Map<string, VisitBookInvoice[]>();
    if (encounterIds.length === 0) return result;
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; encounter_id: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT i.id, i.encounter_id, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
         WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.status::text IN ('UNPAID', 'PAID') AND i.encounter_id = ANY(${encounterIds as string[]}::uuid[])
         ORDER BY i.created_at ASC, i.id ASC`,
      tx.$queryRaw<Array<{ invoice_id: string; exam_type_name: string; is_drug: boolean; line_total: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT l.invoice_id, l.exam_type_name, (l.source_stock_issue_line_id IS NOT NULL) AS is_drug, l.line_total, l.discount_type, l.discount_value
          FROM invoice_line l JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status::text IN ('UNPAID', 'PAID') AND i.encounter_id = ANY(${encounterIds as string[]}::uuid[])
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, VisitBookInvoice['lines'][number][]>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ name: l.exam_type_name, isDrug: l.is_drug, lineTotal: Number(l.line_total), discountType: l.discount_type, discountValue: l.discount_value === null ? null : Number(l.discount_value) });
      byInvoice.set(l.invoice_id, list);
    }
    for (const inv of invoices) {
      const list = result.get(inv.encounter_id) ?? [];
      list.push({ totalAmount: Number(inv.total_amount), discountType: inv.discount_type, discountValue: inv.discount_value === null ? null : Number(inv.discount_value), lines: byInvoice.get(inv.id) ?? [] });
      result.set(inv.encounter_id, list);
    }
    return result;
  }
}
