import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Truy vấn RIÊNG của tab "Khám chéo chi nhánh" ở trang "Toàn hệ thống" (docs/DECISIONS.md #287). Các tab khác dùng lại truy vấn từng chi nhánh của các báo cáo đã có. SQL phẳng, CHỈ ĐỌC, mọi
 * truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)`. Bệnh nhân dùng chung cả công ty (#231) nên một bệnh nhân có thể có lượt khám ở nhiều chi nhánh; báo cáo này KHÔNG đọc tiền
 * (ngoại lệ xem liên chi nhánh chỉ cho dữ liệu đi theo người bệnh, tiền của chi nhánh không được gán không bao giờ lộ ra).
 */
export interface CrossRange {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface CrossTotalsRaw {
  patientCount: number;
  crossPatientCount: number;
  crossVisits: number;
}

export interface CrossPairRaw {
  branchAId: string;
  branchBId: string;
  patientCount: number;
}

export interface CrossPatientRaw {
  patientId: string;
  patientCode: string;
  patientName: string;
  branchCount: number;
  visitCount: number;
  lastVisitDate: string;
  branches: Array<{ branchId: string; visits: number }>;
}

/** Lượt khám đã tiếp nhận (chờ, đang khám, hoàn tất) của bệnh nhân theo từng chi nhánh trong phạm vi và kỳ. */
const perPatientBranch = (r: CrossRange) => Prisma.sql`
  SELECT e.patient_id, e.branch_id, COUNT(*)::int AS n, MAX(e.checked_in_at) AS last_at
    FROM encounter e
   WHERE e.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND e.deleted_at IS NULL
     AND e.status::text IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')
     AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
   GROUP BY e.patient_id, e.branch_id`;

@Injectable()
export class SystemReportRepository {
  /** Số bệnh nhân khác nhau, số bệnh nhân khám ở từ hai chi nhánh trở lên và tổng lượt khám của họ. */
  async crossTotals(tx: Prisma.TransactionClient, r: CrossRange): Promise<CrossTotalsRaw> {
    const rows = await tx.$queryRaw<Array<{ patients: number; cross: number; cross_visits: number }>>`
      WITH v AS (${perPatientBranch(r)}),
      per AS (SELECT patient_id, COUNT(*)::int AS bc, SUM(n)::int AS vc FROM v GROUP BY patient_id)
      SELECT COUNT(*)::int AS patients,
             (COUNT(*) FILTER (WHERE bc >= 2))::int AS cross,
             COALESCE(SUM(vc) FILTER (WHERE bc >= 2), 0)::int AS cross_visits
        FROM per`;
    const row = rows[0];
    return { patientCount: row?.patients ?? 0, crossPatientCount: row?.cross ?? 0, crossVisits: row?.cross_visits ?? 0 };
  }

  /** Mỗi cặp chi nhánh (A < B theo id): số bệnh nhân có lượt khám ở cả hai; nhiều nhất trước. */
  async crossPairs(tx: Prisma.TransactionClient, r: CrossRange): Promise<CrossPairRaw[]> {
    const rows = await tx.$queryRaw<Array<{ a: string; b: string; n: number }>>`
      WITH v AS (${perPatientBranch(r)})
      SELECT a.branch_id AS a, b.branch_id AS b, COUNT(*)::int AS n
        FROM v a
        JOIN v b ON b.patient_id = a.patient_id AND a.branch_id < b.branch_id
       GROUP BY a.branch_id, b.branch_id
       ORDER BY n DESC, a.branch_id, b.branch_id`;
    return rows.map((x) => ({ branchAId: x.a, branchBId: x.b, patientCount: x.n }));
  }

  /** Bệnh nhân khám ở từ hai chi nhánh trở lên: nhiều lượt nhất trước, rồi khám gần nhất; đọc `limit` bệnh nhân. */
  async crossPatients(tx: Prisma.TransactionClient, r: CrossRange, limit: number): Promise<CrossPatientRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ patient_id: string; patient_code: string; full_name: string; bc: number; vc: number; last_day: string; branches: Array<{ branchId: string; visits: number }> }>
    >`
      WITH v AS (${perPatientBranch(r)}),
      per AS (SELECT patient_id, COUNT(*)::int AS bc, SUM(n)::int AS vc, MAX(last_at) AS last_at FROM v GROUP BY patient_id HAVING COUNT(*) >= 2)
      SELECT per.patient_id, p.patient_code, p.full_name, per.bc, per.vc,
             to_char((per.last_at AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD') AS last_day,
             (SELECT jsonb_agg(jsonb_build_object('branchId', x.branch_id, 'visits', x.n) ORDER BY x.n DESC, x.branch_id) FROM v x WHERE x.patient_id = per.patient_id) AS branches
        FROM per
        JOIN patient p ON p.tenant_id = ${r.tenantId}::uuid AND p.id = per.patient_id
       ORDER BY per.vc DESC, per.last_at DESC, per.patient_id
       LIMIT ${limit}`;
    return rows.map((x) => ({ patientId: x.patient_id, patientCode: x.patient_code, patientName: x.full_name, branchCount: x.bc, visitCount: x.vc, lastVisitDate: x.last_day, branches: x.branches ?? [] }));
  }
}
