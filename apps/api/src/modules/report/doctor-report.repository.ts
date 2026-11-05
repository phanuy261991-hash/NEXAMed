import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DoctorStatRaw } from '@nexamed/core';
import type { DiscountType } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Bác sĩ" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231; phạm vi do
 * `ReportBranchScopeService` giải quyết ở service). KHÔNG tính tiền ở đây (chiết khấu và chia nhóm ở `@nexamed/core`). "Lượt khám" = lượt đã HOÀN TẤT có bác sĩ, theo ngày tiếp nhận giờ Việt Nam.
 */
const vnDay = (column: string) => Prisma.raw(`to_char((${column} AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD')`);

export interface DoctorRange {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
  /** Chỉ bác sĩ thuộc Khoa này; `null` = mọi Khoa. */
  departmentId: string | null;
}

export interface DoctorInvoiceRaw {
  doctorId: string;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: Array<{
    lineTotal: number;
    discountType: DiscountType | null;
    discountValue: number | null;
    sourceServiceItemId: string | null;
    sourceStockIssueLineId: string | null;
    sourceOrderItemId: string | null;
    sourceOrderPackageId: string | null;
  }>;
}

export interface TopItemRaw {
  name: string;
  count: number;
  doctorCount: number;
}

export interface AssignmentRaw {
  userId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  restMinutes: number | null;
  standardWorkMinutes: number | null;
}

export interface LeaveRaw {
  userId: string;
  leaveDate: string;
  minutes: number;
}

const COMPLETED = Prisma.sql`e.status::text = 'COMPLETED' AND e.doctor_id IS NOT NULL`;

@Injectable()
export class DoctorReportRepository {
  private deptFilter(r: DoctorRange) {
    return r.departmentId === null ? Prisma.sql`TRUE` : Prisma.sql`u.department_id = ${r.departmentId}::uuid`;
  }

  /** Số đếm thô theo bác sĩ: lượt, thời gian khám, có CLS/thuốc/hẹn tái khám, số dòng thuốc/chỉ định, số ngày có khám. */
  async statsByDoctor(tx: Prisma.TransactionClient, r: DoctorRange): Promise<DoctorStatRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{
        doctor_id: string;
        full_name: string;
        department_id: string | null;
        dept_name: string | null;
        visits: number;
        measured: number;
        sum_min: number;
        with_cls: number;
        cls_in: number;
        cls_out: number;
        with_rx: number;
        rx_items: number;
        with_fu: number;
        active_days: number;
      }>
    >`
      SELECT e.doctor_id, u.full_name, u.department_id, dep.name AS dept_name,
             COUNT(*)::int AS visits,
             (COUNT(*) FILTER (WHERE e.started_at IS NOT NULL AND e.completed_at >= e.started_at))::int AS measured,
             COALESCE(SUM(EXTRACT(EPOCH FROM (e.completed_at - e.started_at)) / 60.0) FILTER (WHERE e.started_at IS NOT NULL AND e.completed_at >= e.started_at), 0)::float8 AS sum_min,
             (COUNT(*) FILTER (WHERE co.n > 0))::int AS with_cls,
             COALESCE(SUM(co.in_house), 0)::int AS cls_in,
             COALESCE(SUM(co.external), 0)::int AS cls_out,
             (COUNT(*) FILTER (WHERE rx.items > 0))::int AS with_rx,
             COALESCE(SUM(rx.items), 0)::int AS rx_items,
             (COUNT(*) FILTER (WHERE fu.n > 0))::int AS with_fu,
             COUNT(DISTINCT ${vnDay('e.checked_in_at')})::int AS active_days
        FROM encounter e
        JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
        LEFT JOIN department dep ON dep.tenant_id = u.tenant_id AND dep.id = u.department_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n,
                 (COUNT(*) FILTER (WHERE i.performance::text = 'IN_HOUSE'))::int AS in_house,
                 (COUNT(*) FILTER (WHERE i.performance::text = 'EXTERNAL'))::int AS external
            FROM clinical_order o
            JOIN clinical_order_item i ON i.tenant_id = o.tenant_id AND i.clinical_order_id = o.id
           WHERE o.tenant_id = e.tenant_id AND o.encounter_id = e.id AND o.deleted_at IS NULL AND i.deleted_at IS NULL AND i.status::text <> 'CANCELLED'
        ) co ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(pi.id)::int AS items
            FROM prescription p
            JOIN prescription_item pi ON pi.tenant_id = p.tenant_id AND pi.prescription_id = p.id
           WHERE p.tenant_id = e.tenant_id AND p.encounter_id = e.id AND p.deleted_at IS NULL AND pi.deleted_at IS NULL
        ) rx ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS n
            FROM encounter_treatment_plan t
           WHERE t.tenant_id = e.tenant_id AND t.encounter_id = e.id AND t.deleted_at IS NULL AND t.signed_at IS NOT NULL AND t.directions::text[] @> ARRAY['FOLLOW_UP']
        ) fu ON TRUE
       WHERE e.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COMPLETED}
         AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end} AND ${this.deptFilter(r)}
       GROUP BY e.doctor_id, u.full_name, u.department_id, dep.name`;
    return rows.map((x) => ({
      doctorId: x.doctor_id,
      doctorName: x.full_name,
      departmentId: x.department_id,
      departmentName: x.dept_name ?? '',
      visits: x.visits,
      measured: x.measured,
      sumMinutes: x.sum_min,
      withCls: x.with_cls,
      clsInHouse: x.cls_in,
      clsExternal: x.cls_out,
      withPrescription: x.with_rx,
      prescriptionItems: x.rx_items,
      withFollowUp: x.with_fu,
      activeDays: x.active_days,
    }));
  }

  /** Phiếu CHƯA HUỶ (chưa thu + đã thu) của các lượt khám đã hoàn tất của bác sĩ trong đoạn, kèm dòng — để tính doanh thu GHI NHẬN sinh ra theo bác sĩ. */
  async listDoctorInvoices(tx: Prisma.TransactionClient, r: DoctorRange): Promise<DoctorInvoiceRaw[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; doctor_id: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT i.id, e.doctor_id, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
          JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
         WHERE i.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL AND ${COMPLETED}
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end} AND ${this.deptFilter(r)}
         ORDER BY i.id`,
      tx.$queryRaw<
        Array<{
          invoice_id: string;
          line_total: bigint;
          discount_type: DiscountType | null;
          discount_value: bigint | null;
          source_service_item_id: string | null;
          source_stock_issue_line_id: string | null;
          source_order_item_id: string | null;
          source_order_package_id: string | null;
        }>
      >`
        SELECT l.invoice_id, l.line_total, l.discount_type, l.discount_value,
               l.source_service_item_id, l.source_stock_issue_line_id, l.source_order_item_id, l.source_order_package_id
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
          JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
         WHERE l.tenant_id = ${r.tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL AND ${COMPLETED}
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end} AND ${this.deptFilter(r)}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, DoctorInvoiceRaw['lines']>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({
        lineTotal: Number(l.line_total),
        discountType: l.discount_type,
        discountValue: l.discount_value === null ? null : Number(l.discount_value),
        sourceServiceItemId: l.source_service_item_id,
        sourceStockIssueLineId: l.source_stock_issue_line_id,
        sourceOrderItemId: l.source_order_item_id,
        sourceOrderPackageId: l.source_order_package_id,
      });
      byInvoice.set(l.invoice_id, list);
    }
    return invoices.map((i) => ({
      doctorId: i.doctor_id,
      totalAmount: Number(i.total_amount),
      discountType: i.discount_type,
      discountValue: i.discount_value === null ? null : Number(i.discount_value),
      lines: byInvoice.get(i.id) ?? [],
    }));
  }

  /** Thuốc được kê nhiều dòng nhất (tên thuốc trong danh mục, hoặc tên tự do), kèm số bác sĩ đã kê. */
  async topDrugs(tx: Prisma.TransactionClient, r: DoctorRange, limit: number): Promise<TopItemRaw[]> {
    const rows = await tx.$queryRaw<Array<{ name: string; n: number; doctors: number }>>`
      SELECT COALESCE(d.name, pi.free_text_drug_name, 'Không rõ tên') AS name, COUNT(*)::int AS n, COUNT(DISTINCT e.doctor_id)::int AS doctors
        FROM prescription_item pi
        JOIN prescription p ON p.tenant_id = pi.tenant_id AND p.id = pi.prescription_id
        JOIN encounter e ON e.tenant_id = p.tenant_id AND e.id = p.encounter_id
        JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
        LEFT JOIN drug d ON d.tenant_id = pi.tenant_id AND d.id = pi.drug_id
       WHERE pi.tenant_id = ${r.tenantId}::uuid AND pi.deleted_at IS NULL AND p.deleted_at IS NULL
         AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COMPLETED}
         AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end} AND ${this.deptFilter(r)}
       GROUP BY 1
       ORDER BY n DESC, name ASC
       LIMIT ${limit}`;
    return rows.map((x) => ({ name: x.name, count: x.n, doctorCount: x.doctors }));
  }

  /** Chỉ định cận lâm sàng nhiều nhất (không tính dòng đã huỷ), kèm số bác sĩ đã chỉ định. */
  async topOrders(tx: Prisma.TransactionClient, r: DoctorRange, limit: number): Promise<TopItemRaw[]> {
    const rows = await tx.$queryRaw<Array<{ name: string; n: number; doctors: number }>>`
      SELECT i.name, COUNT(*)::int AS n, COUNT(DISTINCT e.doctor_id)::int AS doctors
        FROM clinical_order_item i
        JOIN clinical_order o ON o.tenant_id = i.tenant_id AND o.id = i.clinical_order_id
        JOIN encounter e ON e.tenant_id = o.tenant_id AND e.id = o.encounter_id
        JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
       WHERE i.tenant_id = ${r.tenantId}::uuid AND i.deleted_at IS NULL AND o.deleted_at IS NULL AND i.status::text <> 'CANCELLED'
         AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND e.deleted_at IS NULL AND ${COMPLETED}
         AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end} AND ${this.deptFilter(r)}
       GROUP BY i.name
       ORDER BY n DESC, i.name ASC
       LIMIT ${limit}`;
    return rows.map((x) => ({ name: x.name, count: x.n, doctorCount: x.doctors }));
  }

  /** Ca đã xếp (Lịch làm việc) trong khoảng ngày ở các chi nhánh của phạm vi — mỗi dòng một lượt xếp, kèm cấu hình ca để tính phút ở `@nexamed/core`. */
  async listAssignments(tx: Prisma.TransactionClient, p: { tenantId: string; branchIds: string[]; from: string; to: string }): Promise<AssignmentRaw[]> {
    const rows = await tx.$queryRaw<Array<{ user_id: string; d: string; start_time: string; end_time: string; rest_minutes: number | null; standard_work_minutes: number | null }>>`
      SELECT a.user_id, to_char(a.work_date, 'YYYY-MM-DD') AS d, s.start_time, s.end_time, s.rest_minutes, s.standard_work_minutes
        FROM work_shift_assignment a
        JOIN work_shift s ON s.tenant_id = a.tenant_id AND s.id = a.work_shift_id
       WHERE a.tenant_id = ${p.tenantId}::uuid AND a.branch_id = ANY(${p.branchIds}::uuid[]) AND a.deleted_at IS NULL
         AND a.work_date >= ${p.from}::date AND a.work_date <= ${p.to}::date`;
    return rows.map((x) => ({ userId: x.user_id, workDate: x.d, startTime: x.start_time, endTime: x.end_time, restMinutes: x.rest_minutes, standardWorkMinutes: x.standard_work_minutes }));
  }

  /** Đơn xin nghỉ ĐÃ DUYỆT trong khoảng ngày ở các chi nhánh của phạm vi: ngày nghỉ và số phút nghỉ. */
  async listApprovedLeaves(tx: Prisma.TransactionClient, p: { tenantId: string; branchIds: string[]; from: string; to: string }): Promise<LeaveRaw[]> {
    const rows = await tx.$queryRaw<Array<{ user_id: string; d: string; minutes: number }>>`
      SELECT user_id, to_char(leave_date, 'YYYY-MM-DD') AS d, GREATEST(end_minute - start_minute, 0)::int AS minutes
        FROM leave_request
       WHERE tenant_id = ${p.tenantId}::uuid AND branch_id = ANY(${p.branchIds}::uuid[]) AND status = 'APPROVED' AND deleted_at IS NULL
         AND leave_date >= ${p.from}::date AND leave_date <= ${p.to}::date`;
    return rows.map((x) => ({ userId: x.user_id, leaveDate: x.d, minutes: x.minutes }));
  }
}
