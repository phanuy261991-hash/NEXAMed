import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FREQUENCY_MAX_VISITS, RETURN_GAP_LOWER_BOUNDS, type DemographicRaw, type NewReturningRaw } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Bệnh nhân" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231; phạm vi do
 * `ReportBranchScopeService` giải quyết ở service). "Lượt khám" = lượt đã tiếp nhận (chờ khám, đang khám, hoàn tất) theo ngày tiếp nhận giờ Việt Nam. "Bệnh nhân mới" = lượt đầu tiên của
 * bệnh nhân ở BẤT KỲ chi nhánh nào của công ty (bệnh nhân dùng chung cả công ty). KHÔNG tính tiền ở đây.
 */
const COUNTED = Prisma.sql`e.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')`;
const COUNTED_PRIOR = Prisma.sql`p.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')`;
const vnLocal = (column: string) => Prisma.raw(`((${column} AT TIME ZONE 'UTC') + interval '7 hours')`);
const GAP_BOUNDS = Prisma.raw(`ARRAY[${RETURN_GAP_LOWER_BOUNDS.join(',')}]`);

export interface PatientPeriod {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
  /** Ngày đầu/cuối kỳ (`YYYY-MM-DD`, giờ Việt Nam) — tính tuổi đến ngày cuối kỳ. */
  from: string;
  to: string;
}

export interface MonthRaw {
  month: string;
  visits: number;
  patients: number;
  newPatients: number;
}

export interface PlaceRaw {
  code: string;
  name: string;
  provinceName: string;
  patients: number;
}

export interface NotReturningFilter {
  tenantId: string;
  branchIds: string[];
  from: string;
  to: string;
  /** Hôm nay theo giờ Việt Nam: chỉ hẹn có ngày hẹn TRƯỚC hôm nay mới là quá hạn. */
  today: string;
}

export interface NotReturningSummaryRaw {
  patients: number;
  reminded: number;
  markedNotReturning: number;
  avgOverdueDays: number | null;
}

export interface NotReturningRaw {
  patientId: string;
  patientCode: string;
  patientName: string;
  phone: string;
  encounterId: string;
  branchId: string;
  doctorId: string | null;
  visitDate: string;
  dueDate: string;
  reminderCount: number;
  lastReminderResult: string | null;
}

@Injectable()
export class PatientReportRepository {
  /** Bệnh nhân có ít nhất một lượt khám trong kỳ ở các chi nhánh của phạm vi (dùng làm bộ lọc `patient.id IN (...)`). */
  private visitedPatients(p: PatientPeriod): Prisma.Sql {
    return Prisma.sql`SELECT DISTINCT e.patient_id FROM encounter e
       WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COUNTED}
         AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}`;
  }

  /**
   * Bệnh nhân có khám trong kỳ, gom theo (mới/cũ, số lượt trong kỳ gộp tại `FREQUENCY_MAX_VISITS`, khoảng cách từ lượt liền trước — chỉ bệnh nhân cũ). Khoảng cách tính theo
   * NGÀY lịch Việt Nam giữa lượt liền trước và lượt đầu tiên của kỳ.
   */
  async newReturningGroups(tx: Prisma.TransactionClient, p: PatientPeriod): Promise<NewReturningRaw[]> {
    const rows = await tx.$queryRaw<Array<{ is_new: boolean; visits: number; gap_index: number | null; patients: number; total_visits: number }>>`
      WITH w AS (
        SELECT e.patient_id, COUNT(*)::int AS visits, MIN(e.checked_in_at) AS first_at
          FROM encounter e
         WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COUNTED}
           AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
         GROUP BY e.patient_id
      ), g AS (
        SELECT w.patient_id, w.visits, w.first_at,
               (SELECT MAX(p.checked_in_at) FROM encounter p
                 WHERE p.tenant_id = ${p.tenantId}::uuid AND p.patient_id = w.patient_id AND p.deleted_at IS NULL AND ${COUNTED_PRIOR} AND p.checked_in_at < w.first_at) AS prev_at
          FROM w
      )
      SELECT (prev_at IS NULL) AS is_new,
             LEAST(visits, ${FREQUENCY_MAX_VISITS})::int AS visits,
             CASE WHEN prev_at IS NULL THEN NULL
                  ELSE width_bucket((${vnLocal('first_at')}::date - ${vnLocal('prev_at')}::date), ${GAP_BOUNDS})::int END AS gap_index,
             COUNT(*)::int AS patients,
             SUM(visits)::int AS total_visits
        FROM g
       GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ isNew: r.is_new, visits: r.visits, gapIndex: r.gap_index, patients: r.patients, totalVisits: r.total_visits }));
  }

  /** Theo tháng lịch Việt Nam: số lượt, số bệnh nhân khác nhau, số bệnh nhân khám LẦN ĐẦU (lượt đầu tiên của họ rơi vào tháng đó). */
  async monthRows(tx: Prisma.TransactionClient, p: PatientPeriod): Promise<MonthRaw[]> {
    const rows = await tx.$queryRaw<Array<{ m: string; visits: number; patients: number; new_patients: number }>>`
      WITH x AS (
        SELECT to_char(${vnLocal('e.checked_in_at')}, 'YYYY-MM') AS m, e.patient_id,
               NOT EXISTS (
                 SELECT 1 FROM encounter p
                  WHERE p.tenant_id = e.tenant_id AND p.patient_id = e.patient_id AND p.deleted_at IS NULL AND ${COUNTED_PRIOR}
                    AND (p.checked_in_at < e.checked_in_at OR (p.checked_in_at = e.checked_in_at AND p.id < e.id))) AS is_first
          FROM encounter e
         WHERE e.tenant_id = ${p.tenantId}::uuid AND e.branch_id = ANY(${p.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COUNTED}
           AND e.checked_in_at >= ${p.start} AND e.checked_in_at < ${p.end}
      )
      SELECT m, COUNT(*)::int AS visits, COUNT(DISTINCT patient_id)::int AS patients, (COUNT(*) FILTER (WHERE is_first))::int AS new_patients
        FROM x GROUP BY m ORDER BY m`;
    return rows.map((r) => ({ month: r.m, visits: r.visits, patients: r.patients, newPatients: r.new_patients }));
  }

  /** Bệnh nhân có khám trong kỳ theo (tuổi tròn năm đến ngày cuối kỳ, giới tính). */
  async demographicRows(tx: Prisma.TransactionClient, p: PatientPeriod): Promise<DemographicRaw[]> {
    const rows = await tx.$queryRaw<Array<{ age: number | null; gender: string; n: number }>>`
      SELECT date_part('year', age(${p.to}::date, pt.dob))::int AS age, pt.gender::text AS gender, COUNT(*)::int AS n
        FROM patient pt
       WHERE pt.tenant_id = ${p.tenantId}::uuid AND pt.deleted_at IS NULL AND pt.id IN (${this.visitedPatients(p)})
       GROUP BY 1, 2`;
    return rows.map((r) => ({ age: r.age, gender: r.gender, patients: r.n }));
  }

  /** Số bệnh nhân có khám theo tỉnh/thành ghi trên hồ sơ (mã tỉnh trong `address_json`); `code` rỗng = chưa ghi. */
  async provinceRows(tx: Prisma.TransactionClient, p: PatientPeriod): Promise<PlaceRaw[]> {
    const rows = await tx.$queryRaw<Array<{ code: string | null; name: string | null; n: number }>>`
      SELECT NULLIF(pt.address_json->>'province', '') AS code, pr.name, COUNT(*)::int AS n
        FROM patient pt
        LEFT JOIN province pr ON pr.code = pt.address_json->>'province'
       WHERE pt.tenant_id = ${p.tenantId}::uuid AND pt.deleted_at IS NULL AND pt.id IN (${this.visitedPatients(p)})
       GROUP BY 1, 2
       ORDER BY n DESC, name ASC NULLS LAST`;
    return rows.map((r) => ({ code: r.code ?? '', name: r.name ?? r.code ?? '', provinceName: '', patients: r.n }));
  }

  /** Phường/xã có nhiều bệnh nhân có khám nhất, kèm tên tỉnh/thành. */
  async wardRows(tx: Prisma.TransactionClient, p: PatientPeriod, limit: number): Promise<PlaceRaw[]> {
    const rows = await tx.$queryRaw<Array<{ code: string; name: string | null; province_name: string | null; n: number }>>`
      SELECT pt.address_json->>'ward' AS code, w.name, pr.name AS province_name, COUNT(*)::int AS n
        FROM patient pt
        LEFT JOIN ward w ON w.code = pt.address_json->>'ward'
        LEFT JOIN province pr ON pr.code = w.province_code
       WHERE pt.tenant_id = ${p.tenantId}::uuid AND pt.deleted_at IS NULL AND NULLIF(pt.address_json->>'ward', '') IS NOT NULL AND pt.id IN (${this.visitedPatients(p)})
       GROUP BY 1, 2, 3
       ORDER BY n DESC, name ASC NULLS LAST
       LIMIT ${limit}`;
    return rows.map((r) => ({ code: r.code, name: r.name ?? r.code, provinceName: r.province_name ?? '', patients: r.n }));
  }

  /**
   * Bệnh nhân đã hẹn tái khám (kế hoạch ĐÃ KÝ, hướng "Hẹn tái khám", lượt gốc đã hoàn tất) có ngày hẹn trong `[from, to]` và TRƯỚC hôm nay mà chưa có lượt khám nào sau lượt gốc
   * ("đã quay lại" theo cùng quy tắc trang Hẹn tái khám, #285). Mỗi bệnh nhân một dòng — hẹn có ngày hẹn muộn nhất.
   */
  private notReturningCte(f: NotReturningFilter): Prisma.Sql {
    return Prisma.sql`
      SELECT DISTINCT ON (e.patient_id) e.patient_id, e.id AS encounter_id, e.branch_id, e.doctor_id, e.checked_in_at AS visit_at, tp.follow_up_date AS due
        FROM encounter_treatment_plan tp
        JOIN encounter e ON e.tenant_id = tp.tenant_id AND e.id = tp.encounter_id
       WHERE tp.tenant_id = ${f.tenantId}::uuid AND tp.deleted_at IS NULL AND tp.signed_at IS NOT NULL
         AND 'FOLLOW_UP' = ANY(tp.directions::text[]) AND tp.follow_up_date IS NOT NULL
         AND tp.follow_up_date >= ${f.from}::date AND tp.follow_up_date <= ${f.to}::date AND tp.follow_up_date < ${f.today}::date
         AND e.branch_id = ANY(${f.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.status::text = 'COMPLETED'
         AND NOT EXISTS (
           SELECT 1 FROM encounter p
            WHERE p.tenant_id = e.tenant_id AND p.patient_id = e.patient_id AND p.deleted_at IS NULL AND p.id <> e.id
              AND ${COUNTED_PRIOR} AND p.checked_in_at > e.checked_in_at)
       ORDER BY e.patient_id, tp.follow_up_date DESC, e.checked_in_at DESC`;
  }

  async notReturningSummary(tx: Prisma.TransactionClient, f: NotReturningFilter): Promise<NotReturningSummaryRaw> {
    const rows = await tx.$queryRaw<Array<{ patients: number; reminded: number; marked: number; avg_days: number | null }>>`
      WITH f AS (${this.notReturningCte(f)})
      SELECT COUNT(*)::int AS patients,
             (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM follow_up_reminder r WHERE r.tenant_id = ${f.tenantId}::uuid AND r.encounter_id = f.encounter_id AND r.deleted_at IS NULL)))::int AS reminded,
             (COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM follow_up_reminder r WHERE r.tenant_id = ${f.tenantId}::uuid AND r.encounter_id = f.encounter_id AND r.deleted_at IS NULL AND r.result::text = 'NOT_RETURNING')))::int AS marked,
             AVG(${f.today}::date - f.due)::float8 AS avg_days
        FROM f`;
    const r = rows[0];
    return { patients: r?.patients ?? 0, reminded: r?.reminded ?? 0, markedNotReturning: r?.marked ?? 0, avgOverdueDays: r?.avg_days ?? null };
  }

  /** Danh sách: quá hẹn lâu nhất trước, tối đa `limit` dòng. */
  async notReturningList(tx: Prisma.TransactionClient, f: NotReturningFilter, limit: number): Promise<NotReturningRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{
        patient_id: string;
        patient_code: string;
        full_name: string;
        phone: string;
        encounter_id: string;
        branch_id: string;
        doctor_id: string | null;
        visit_day: string;
        due_day: string;
        reminder_count: number;
        last_result: string | null;
      }>
    >`
      WITH f AS (${this.notReturningCte(f)})
      SELECT f.patient_id, pt.patient_code, pt.full_name, pt.phone, f.encounter_id, f.branch_id, f.doctor_id,
             to_char(${vnLocal('f.visit_at')}, 'YYYY-MM-DD') AS visit_day, to_char(f.due, 'YYYY-MM-DD') AS due_day,
             (SELECT COUNT(*)::int FROM follow_up_reminder r WHERE r.tenant_id = ${f.tenantId}::uuid AND r.encounter_id = f.encounter_id AND r.deleted_at IS NULL) AS reminder_count,
             (SELECT r.result::text FROM follow_up_reminder r WHERE r.tenant_id = ${f.tenantId}::uuid AND r.encounter_id = f.encounter_id AND r.deleted_at IS NULL ORDER BY r.reminded_at DESC, r.id DESC LIMIT 1) AS last_result
        FROM f
        JOIN patient pt ON pt.tenant_id = ${f.tenantId}::uuid AND pt.id = f.patient_id
       ORDER BY f.due ASC, pt.full_name ASC, f.patient_id ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({
      patientId: r.patient_id,
      patientCode: r.patient_code,
      patientName: r.full_name,
      phone: r.phone,
      encounterId: r.encounter_id,
      branchId: r.branch_id,
      doctorId: r.doctor_id,
      visitDate: r.visit_day,
      dueDate: r.due_day,
      reminderCount: r.reminder_count,
      lastReminderResult: r.last_result,
    }));
  }

  /** Tên bác sĩ theo id (hiển thị `display_name` nếu có). */
  async doctorNames(tx: Prisma.TransactionClient, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, COALESCE(display_name, full_name) AS name FROM user_account WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids as string[]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
