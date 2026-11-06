import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InteropDoctorCount, InteropStatusCount } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Chất lượng và tuân thủ" (docs/DECISIONS.md #290). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231; phạm vi do
 * `ReportBranchScopeService` giải quyết ở service). "Từ các ngày trước" = trước 00:00 hôm nay giờ Việt Nam (`todayStart`). KHÔNG tính tiền ở đây.
 */
const vnLocal = (column: string) => Prisma.raw(`((${column} AT TIME ZONE 'UTC') + interval '7 hours')`);

export interface QualityScope {
  tenantId: string;
  branchIds: string[];
}

export interface QualityInteropPeriod extends QualityScope {
  start: Date;
  end: Date;
}

export interface StaleEncounterRaw {
  encounterId: string;
  encounterNo: string;
  patientCode: string;
  patientName: string;
  status: string;
  visitDate: string;
  doctorId: string | null;
  branchId: string;
}

export interface OpenShiftRaw {
  shiftId: string;
  shiftNo: string;
  cashierName: string;
  openedAt: Date;
  branchId: string;
}

export interface InteropProblemRaw {
  submissionId: string;
  encounterId: string;
  encounterNo: string;
  patientCode: string;
  patientName: string;
  doctorId: string | null;
  nationalCode: string;
  status: string;
  attempts: number;
  lastHttpStatus: number | null;
  errors: string[];
  signedAt: Date;
  nextAttemptAt: Date | null;
  branchId: string;
}

@Injectable()
export class QualityReportRepository {
  // ---- Lượt khám chưa hoàn tất ----

  /** Lượt chờ khám hoặc đang khám tiếp nhận TRƯỚC `todayStart` (đáng lẽ đã hoàn tất/huỷ). */
  private staleWhere(s: QualityScope, todayStart: Date): Prisma.Sql {
    return Prisma.sql`e.tenant_id = ${s.tenantId}::uuid AND e.branch_id = ANY(${s.branchIds}::uuid[]) AND e.deleted_at IS NULL
      AND e.status::text IN ('CHECKED_IN', 'IN_CONSULTATION') AND e.checked_in_at < ${todayStart}`;
  }

  async staleCount(tx: Prisma.TransactionClient, s: QualityScope, todayStart: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM encounter e WHERE ${this.staleWhere(s, todayStart)}`;
    return rows[0]?.n ?? 0;
  }

  async staleList(tx: Prisma.TransactionClient, s: QualityScope, todayStart: Date, limit: number): Promise<StaleEncounterRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; encounter_no: string; patient_code: string; full_name: string; status: string; visit_day: string; doctor_id: string | null; branch_id: string }>
    >`
      SELECT e.id, e.encounter_no, pt.patient_code, pt.full_name, e.status::text AS status, to_char(${vnLocal('e.checked_in_at')}, 'YYYY-MM-DD') AS visit_day, e.doctor_id, e.branch_id
        FROM encounter e
        JOIN patient pt ON pt.tenant_id = e.tenant_id AND pt.id = e.patient_id
       WHERE ${this.staleWhere(s, todayStart)}
       ORDER BY e.checked_in_at ASC, e.id ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ encounterId: r.id, encounterNo: r.encounter_no, patientCode: r.patient_code, patientName: r.full_name, status: r.status, visitDate: r.visit_day, doctorId: r.doctor_id, branchId: r.branch_id }));
  }

  /** Ca thu ngân còn MỞ, mở trước `todayStart`. */
  private shiftWhere(s: QualityScope, todayStart: Date): Prisma.Sql {
    return Prisma.sql`cs.tenant_id = ${s.tenantId}::uuid AND cs.branch_id = ANY(${s.branchIds}::uuid[]) AND cs.deleted_at IS NULL AND cs.status::text = 'OPEN' AND cs.opened_at < ${todayStart}`;
  }

  async openShiftCount(tx: Prisma.TransactionClient, s: QualityScope, todayStart: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM cashier_shift cs WHERE ${this.shiftWhere(s, todayStart)}`;
    return rows[0]?.n ?? 0;
  }

  async openShiftList(tx: Prisma.TransactionClient, s: QualityScope, todayStart: Date, limit: number): Promise<OpenShiftRaw[]> {
    const rows = await tx.$queryRaw<Array<{ id: string; shift_no: string; name: string; opened_at: Date; branch_id: string }>>`
      SELECT cs.id, cs.shift_no, COALESCE(u.display_name, u.full_name) AS name, cs.opened_at, cs.branch_id
        FROM cashier_shift cs
        JOIN user_account u ON u.tenant_id = cs.tenant_id AND u.id = cs.cashier_id
       WHERE ${this.shiftWhere(s, todayStart)}
       ORDER BY cs.opened_at ASC, cs.id ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({ shiftId: r.id, shiftNo: r.shift_no, cashierName: r.name, openedAt: r.opened_at, branchId: r.branch_id }));
  }

  /** Phiếu thu CHƯA THU của lượt khám tiếp nhận trước `todayStart`. */
  async unpaidOldCount(tx: Prisma.TransactionClient, s: QualityScope, todayStart: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
        FROM invoice i
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE i.tenant_id = ${s.tenantId}::uuid AND i.deleted_at IS NULL AND i.status::text = 'UNPAID'
         AND e.branch_id = ANY(${s.branchIds}::uuid[]) AND e.deleted_at IS NULL AND e.checked_in_at < ${todayStart}`;
    return rows[0]?.n ?? 0;
  }

  // ---- Liên thông đơn thuốc ----

  private interopWhere(p: QualityInteropPeriod): Prisma.Sql {
    return Prisma.sql`s.tenant_id = ${p.tenantId}::uuid AND s.branch_id = ANY(${p.branchIds}::uuid[]) AND s.deleted_at IS NULL AND s.signed_at >= ${p.start} AND s.signed_at < ${p.end}`;
  }

  async interopStatusCounts(tx: Prisma.TransactionClient, p: QualityInteropPeriod): Promise<InteropStatusCount[]> {
    const rows = await tx.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT s.status, COUNT(*)::int AS n FROM prescription_submission s WHERE ${this.interopWhere(p)} GROUP BY s.status`;
    return rows.map((r) => ({ status: r.status, count: r.n }));
  }

  async interopDoctorCounts(tx: Prisma.TransactionClient, p: QualityInteropPeriod, noDoctorName: string): Promise<InteropDoctorCount[]> {
    const rows = await tx.$queryRaw<Array<{ doctor_id: string | null; name: string | null; status: string; n: number }>>`
      SELECT s.doctor_user_id AS doctor_id, COALESCE(u.display_name, u.full_name) AS name, s.status, COUNT(*)::int AS n
        FROM prescription_submission s
        LEFT JOIN user_account u ON u.tenant_id = s.tenant_id AND u.id = s.doctor_user_id
       WHERE ${this.interopWhere(p)}
       GROUP BY 1, 2, 3`;
    return rows.map((r) => ({ doctorId: r.doctor_id, doctorName: r.name ?? noDoctorName, status: r.status, count: r.n }));
  }

  private problemWhere(p: QualityInteropPeriod): Prisma.Sql {
    return Prisma.sql`${this.interopWhere(p)} AND s.status IN ('PENDING', 'FAILED')`;
  }

  async interopProblemTotal(tx: Prisma.TransactionClient, p: QualityInteropPeriod): Promise<{ total: number; oldest: Date | null }> {
    const rows = await tx.$queryRaw<Array<{ n: number; oldest: Date | null }>>`
      SELECT COUNT(*)::int AS n, MIN(s.signed_at) AS oldest FROM prescription_submission s WHERE ${this.problemWhere(p)}`;
    return { total: rows[0]?.n ?? 0, oldest: rows[0]?.oldest ?? null };
  }

  async interopProblemList(tx: Prisma.TransactionClient, p: QualityInteropPeriod, limit: number): Promise<InteropProblemRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        encounter_id: string;
        encounter_no: string;
        patient_code: string;
        full_name: string;
        doctor_id: string | null;
        national_code: string;
        status: string;
        attempts: number;
        last_http_status: number | null;
        errors: unknown;
        signed_at: Date;
        next_attempt_at: Date | null;
        branch_id: string;
      }>
    >`
      SELECT s.id, s.encounter_id, e.encounter_no, pt.patient_code, pt.full_name, s.doctor_user_id AS doctor_id, s.national_code, s.status, s.attempts, s.last_http_status, s.errors, s.signed_at, s.next_attempt_at, s.branch_id
        FROM prescription_submission s
        JOIN encounter e ON e.tenant_id = s.tenant_id AND e.id = s.encounter_id
        JOIN patient pt ON pt.tenant_id = e.tenant_id AND pt.id = e.patient_id
       WHERE ${this.problemWhere(p)}
       ORDER BY s.signed_at ASC, s.id ASC
       LIMIT ${limit}`;
    return rows.map((r) => ({
      submissionId: r.id,
      encounterId: r.encounter_id,
      encounterNo: r.encounter_no,
      patientCode: r.patient_code,
      patientName: r.full_name,
      doctorId: r.doctor_id,
      nationalCode: r.national_code,
      status: r.status,
      attempts: r.attempts,
      lastHttpStatus: r.last_http_status,
      errors: Array.isArray(r.errors) ? r.errors.filter((x): x is string => typeof x === 'string') : [],
      signedAt: r.signed_at,
      nextAttemptAt: r.next_attempt_at,
      branchId: r.branch_id,
    }));
  }

  /** Tên bác sĩ/người dùng theo id (hiển thị `display_name` nếu có). */
  async userNames(tx: Prisma.TransactionClient, tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<Array<{ id: string; name: string }>>`
      SELECT id, COALESCE(display_name, full_name) AS name FROM user_account WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${ids as string[]}::uuid[])`;
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
