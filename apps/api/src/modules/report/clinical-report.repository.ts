import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { clsKindOf, type ChapterRaw, type ClsKind, type ClsKindRaw, type DiagnosisRaw } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Chuyên môn" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231; phạm vi do
 * `ReportBranchScopeService` giải quyết ở service). KHÔNG tính tiền ở đây. "Lượt khám" = lượt đã HOÀN TẤT theo ngày tiếp nhận giờ Việt Nam. Cận lâm sàng: chỉ định không bị huỷ của lượt khám
 * ĐÃ TIẾP NHẬN trong kỳ; "đã trả kết quả" = bác sĩ đã duyệt (có kết quả đã ký); thời gian trả tính đến lần duyệt đầu tiên.
 */
export interface ClinicalPeriod {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface ClsTopServiceRaw {
  name: string;
  kind: ClsKind;
  ordered: number;
  completed: number;
  measured: number;
  sumMinutes: number;
  overdue: number;
}

export interface ClsOverdueRaw {
  orderItemId: string;
  encounterId: string;
  patientCode: string;
  patientName: string;
  serviceName: string;
  kind: ClsKind;
  branchId: string;
  orderedAt: Date;
  turnaroundMinutes: number;
}

/**
 * Chỉ định hợp lệ của lượt khám đã tiếp nhận trong kỳ, kèm giờ trả kết quả và thời gian trả kết quả đặt ở dịch vụ. Giờ trả kết quả = lần bác sĩ duyệt ĐẦU TIÊN (kể cả bản gốc đã bị thay khi
 * đính chính): đính chính về sau không làm kết quả "trả muộn" hơn.
 */
function itemsCte(p: ClinicalPeriod, now: Date): Prisma.Sql {
  return Prisma.sql`
    SELECT i.id, i.name, i.performance::text AS performance, i.status::text AS status, ts.service_kind::text AS kind, ts.turnaround_minutes AS sla, i.created_at,
           e.id AS encounter_id, e.patient_id, e.branch_id,
           (SELECT MIN(r.signed_at) FROM paraclinical_result r
             WHERE r.tenant_id = i.tenant_id AND r.clinical_order_item_id = i.id AND r.signed_at IS NOT NULL) AS done_at,
           (i.status::text <> 'COMPLETED' AND i.performance::text = 'IN_HOUSE' AND ts.turnaround_minutes IS NOT NULL
             AND i.created_at + make_interval(mins => ts.turnaround_minutes) < ${now}) AS overdue_open
      FROM clinical_order_item i
      JOIN clinical_order o ON o.tenant_id = i.tenant_id AND o.id = i.clinical_order_id
      JOIN encounter e ON e.tenant_id = o.tenant_id AND e.id = o.encounter_id
      LEFT JOIN technical_service ts ON ts.tenant_id = i.tenant_id AND ts.id = i.technical_service_id
     WHERE i.tenant_id = ${p.tenantId}::uuid AND i.deleted_at IS NULL AND o.deleted_at IS NULL AND i.status::text <> 'CANCELLED'
       AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')
       AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}`;
}

/** Trả muộn: đã duyệt và (giờ duyệt − giờ chỉ định) vượt thời gian đặt ở dịch vụ. */
const LATE = Prisma.sql`(status = 'COMPLETED' AND done_at IS NOT NULL AND sla IS NOT NULL AND done_at > created_at + make_interval(mins => sla))`;
const MEASURED = Prisma.sql`(status = 'COMPLETED' AND done_at IS NOT NULL)`;

@Injectable()
export class ClinicalReportRepository {
  // ---- Cơ cấu chẩn đoán ----

  /** Số lượt đã hoàn tất, số lượt có chẩn đoán chính và số mã khác nhau. */
  async diagnosisTotals(tx: Prisma.TransactionClient, p: ClinicalPeriod): Promise<{ completedVisits: number; withDiagnosis: number; distinctCodes: number }> {
    const rows = await tx.$queryRaw<Array<{ completed: number; with_dx: number; codes: number }>>`
      SELECT COUNT(*)::int AS completed,
             (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM diagnosis d WHERE d.tenant_id = e.tenant_id AND d.encounter_id = e.id AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY')))::int AS with_dx,
             (SELECT COUNT(DISTINCT d.icd10_code)::int FROM diagnosis d JOIN encounter x ON x.tenant_id = d.tenant_id AND x.id = d.encounter_id
               WHERE d.tenant_id = ${p.tenantId}::uuid AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY' AND x.deleted_at IS NULL AND x.status::text = 'COMPLETED'
                 AND x.branch_id = ANY(${p.branchIds}::uuid[]) AND x.checked_in_at >= ${p.start} AND x.checked_in_at < ${p.end}) AS codes
        FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
         AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}`;
    const r = rows[0];
    return { completedVisits: r?.completed ?? 0, withDiagnosis: r?.with_dx ?? 0, distinctCodes: r?.codes ?? 0 };
  }

  /** Mã chẩn đoán chính nhiều lượt nhất, kèm số bệnh nhân khác nhau; tên lấy từ danh mục ICD-10. */
  async topDiagnoses(tx: Prisma.TransactionClient, p: ClinicalPeriod, limit: number): Promise<DiagnosisRaw[]> {
    const rows = await tx.$queryRaw<Array<{ code: string; name: string | null; visits: number; patients: number }>>`
      SELECT d.icd10_code AS code, c.name_vi AS name, COUNT(DISTINCT e.id)::int AS visits, COUNT(DISTINCT e.patient_id)::int AS patients
        FROM diagnosis d
        JOIN encounter e ON e.tenant_id = d.tenant_id AND e.id = d.encounter_id
        LEFT JOIN icd10_catalog c ON c.code = d.icd10_code
       WHERE d.tenant_id = ${p.tenantId}::uuid AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY'
         AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
         AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY d.icd10_code, c.name_vi
       ORDER BY visits DESC, d.icd10_code ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ code: r.code, name: r.name ?? '', visits: r.visits, patients: r.patients }));
  }

  /** Số lượt theo chương ICD-10 (mã chính). Mã không còn trong danh mục gom vào chương rỗng và bị bỏ. */
  async chapterRows(tx: Prisma.TransactionClient, p: ClinicalPeriod, limit: number): Promise<ChapterRaw[]> {
    const rows = await tx.$queryRaw<Array<{ chapter_code: string; chapter_name: string; visits: number }>>`
      SELECT c.chapter_code, c.chapter_name, COUNT(DISTINCT e.id)::int AS visits
        FROM diagnosis d
        JOIN encounter e ON e.tenant_id = d.tenant_id AND e.id = d.encounter_id
        JOIN icd10_catalog c ON c.code = d.icd10_code
       WHERE d.tenant_id = ${p.tenantId}::uuid AND d.deleted_at IS NULL AND d.type::text = 'PRIMARY'
         AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
         AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
       GROUP BY c.chapter_code, c.chapter_name
       ORDER BY visits DESC, c.chapter_code ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ chapterCode: r.chapter_code, chapterName: r.chapter_name, visits: r.visits }));
  }

  // ---- Cận lâm sàng ----

  /** Gom theo (nhóm dịch vụ, tại phòng khám/ra ngoài): số chỉ định, đã trả kết quả, số đo được và tổng phút, trả muộn, đang chờ quá hạn. */
  async clsGroups(tx: Prisma.TransactionClient, p: ClinicalPeriod, now: Date): Promise<ClsKindRaw[]> {
    const rows = await tx.$queryRaw<Array<{ kind: string | null; performance: string; ordered: number; completed: number; measured: number; sum_min: number; late: number; open_overdue: number }>>`
      WITH x AS (${itemsCte(p, now)})
      SELECT kind, performance,
             COUNT(*)::int AS ordered,
             (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
             (COUNT(*) FILTER (WHERE ${MEASURED}))::int AS measured,
             COALESCE(SUM(EXTRACT(EPOCH FROM (done_at - created_at)) / 60.0) FILTER (WHERE ${MEASURED}), 0)::float8 AS sum_min,
             (COUNT(*) FILTER (WHERE ${LATE}))::int AS late,
             (COUNT(*) FILTER (WHERE overdue_open))::int AS open_overdue
        FROM x
       GROUP BY kind, performance`;
    return rows.map((r) => ({
      kind: clsKindOf(r.kind),
      inHouse: r.performance === 'IN_HOUSE',
      ordered: r.ordered,
      completed: r.completed,
      measured: r.measured,
      sumMinutes: r.sum_min,
      lateCompleted: r.late,
      overdueOpen: r.open_overdue,
    }));
  }

  /** Dịch vụ được chỉ định nhiều nhất (cùng tên gộp một dòng), kèm số đã trả, trung bình phút và số quá hạn. */
  async clsTopServices(tx: Prisma.TransactionClient, p: ClinicalPeriod, now: Date, limit: number): Promise<ClsTopServiceRaw[]> {
    const rows = await tx.$queryRaw<Array<{ name: string; kind: string | null; ordered: number; completed: number; measured: number; sum_min: number; overdue: number }>>`
      WITH x AS (${itemsCte(p, now)})
      SELECT name, MIN(kind) AS kind, COUNT(*)::int AS ordered,
             (COUNT(*) FILTER (WHERE status = 'COMPLETED'))::int AS completed,
             (COUNT(*) FILTER (WHERE ${MEASURED}))::int AS measured,
             COALESCE(SUM(EXTRACT(EPOCH FROM (done_at - created_at)) / 60.0) FILTER (WHERE ${MEASURED}), 0)::float8 AS sum_min,
             (COUNT(*) FILTER (WHERE ${LATE} OR overdue_open))::int AS overdue
        FROM x
       GROUP BY name
       ORDER BY ordered DESC, name ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ name: r.name, kind: clsKindOf(r.kind), ordered: r.ordered, completed: r.completed, measured: r.measured, sumMinutes: r.sum_min, overdue: r.overdue }));
  }

  /** Chỉ định đang chờ đã quá thời gian trả kết quả, chờ lâu nhất trước. */
  async clsOverdueOpen(tx: Prisma.TransactionClient, p: ClinicalPeriod, now: Date, limit: number): Promise<ClsOverdueRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; encounter_id: string; patient_code: string; full_name: string; name: string; kind: string | null; branch_id: string; created_at: Date; sla: number }>
    >`
      WITH x AS (${itemsCte(p, now)})
      SELECT x.id, x.encounter_id, pt.patient_code, pt.full_name, x.name, x.kind, x.branch_id, x.created_at, x.sla
        FROM x
        JOIN patient pt ON pt.tenant_id = ${p.tenantId}::uuid AND pt.id = x.patient_id
       WHERE x.overdue_open
       ORDER BY x.created_at ASC, x.id ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ orderItemId: r.id, encounterId: r.encounter_id, patientCode: r.patient_code, patientName: r.full_name, serviceName: r.name, kind: clsKindOf(r.kind), branchId: r.branch_id, orderedAt: r.created_at, turnaroundMinutes: r.sla }));
  }
}
