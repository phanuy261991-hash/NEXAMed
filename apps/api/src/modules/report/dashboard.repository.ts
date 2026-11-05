import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscountType, DoctorEncounterInput } from '@nexamed/core';

/**
 * Nạp số liệu thô cho Trang Tổng quan (docs/DECISIONS.md #279). Đây là mô-đun ĐỌC TỔNG HỢP nên truy vấn đi qua nhiều bảng bằng SQL phẳng (đúng tiền lệ `InvoiceRepository.listForDay`,
 * #250); mọi công thức tiền (chiết khấu, chia nhóm) vẫn ở `@nexamed/core` — chỗ này chỉ gom dữ liệu, KHÔNG tính tiền. Mọi truy vấn lọc `tenant_id` và `branch_id` của chi nhánh đang
 * làm việc (hướng chi nhánh #231 — báo cáo là dữ liệu THEO CHI NHÁNH). Ngày/giờ nhóm theo giờ Việt Nam bằng độ lệch +7 giờ cố định (không phụ thuộc bảng múi giờ của Postgres).
 */

/** `YYYY-MM-DD` giờ VN của một cột thời điểm. */
const vnDay = (column: string) => Prisma.raw(`to_char((${column} AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD')`);
const vnHour = (column: string) => Prisma.raw(`EXTRACT(HOUR FROM (${column} AT TIME ZONE 'UTC') + interval '7 hours')::int`);

const COUNTED_STATUSES = Prisma.sql`e.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')`;

export interface DayCount {
  date: string;
  count: number;
}

export interface CollectedLineRow {
  invoiceId: string;
  net: number;
  lineTotal: number | null;
  discountType: DiscountType | null;
  discountValue: number | null;
  sourceServiceItemId: string | null;
  sourceStockIssueLineId: string | null;
  sourceOrderItemId: string | null;
  sourceOrderPackageId: string | null;
}

export interface UnpaidInvoiceRow {
  invoiceId: string;
  encounterId: string;
  invoiceNo: string;
  invoiceType: 'SERVICE' | 'DRUG' | 'PARACLINICAL';
  patientName: string;
  date: string;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: Array<{ name: string; isDrug: boolean; lineTotal: number; discountType: DiscountType | null; discountValue: number | null }>;
}

/** Thanh toán trong khoảng đã gộp theo (phương thức, loại, giờ thu VN). */
export interface PaymentGroupRow {
  methodCode: string;
  type: 'PAYMENT' | 'REFUND';
  hour: number;
  paymentCount: number;
  amount: number;
}

export interface ServiceLineGroup {
  name: string;
  count: number;
  lineTotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
}

export interface QueueRow {
  doctorId: string | null;
  doctorName: string | null;
  roomName: string | null;
  inProgress: number;
  waiting: number;
  oldestWaitingAt: Date | null;
}

/** Lịch hẹn đang hiệu lực (chưa đến / đã chuyển khám) của một ngày, kèm bác sĩ và ngày sinh bệnh nhân (nếu lịch gắn hồ sơ). */
export interface AppointmentDayRow {
  id: string;
  status: 'SCHEDULED' | 'CONVERTED';
  scheduledAt: Date;
  durationMinutes: number;
  patientName: string;
  doctorId: string;
  doctorName: string;
  dob: string | null;
}

export interface FollowUpCounts {
  dueToday: number;
  arrivedToday: number;
  overdueNotArrived: number;
}

@Injectable()
export class DashboardRepository {
  /** Lịch hẹn hôm nay đang hiệu lực (`SCHEDULED` chưa đến, `CONVERTED` đã đến); không tính huỷ/không đến/đã dời. */
  async listAppointmentsForDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<AppointmentDayRow[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: AppointmentDayRow['status']; scheduled_at: Date; duration_minutes: number; full_name: string; doctor_id: string; doctor_name: string; dob: string | null }>
    >`
      SELECT a.id, a.status, a.scheduled_at, a.duration_minutes, a.full_name, a.doctor_id, COALESCE(u.display_name, u.full_name) AS doctor_name,
             to_char(p.dob, 'YYYY-MM-DD') AS dob
        FROM appointment a
        JOIN user_account u ON u.tenant_id = a.tenant_id AND u.id = a.doctor_id
        LEFT JOIN patient p ON p.tenant_id = a.tenant_id AND p.id = a.patient_id
       WHERE a.tenant_id = ${tenantId}::uuid AND a.branch_id = ${branchId}::uuid AND a.deleted_at IS NULL AND a.status IN ('SCHEDULED', 'CONVERTED')
         AND a.scheduled_at >= ${start} AND a.scheduled_at < ${end}
       ORDER BY a.scheduled_at ASC, a.id ASC`;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      scheduledAt: r.scheduled_at,
      durationMinutes: r.duration_minutes,
      patientName: r.full_name,
      doctorId: r.doctor_id,
      doctorName: r.doctor_name,
      dob: r.dob,
    }));
  }

  /** Đơn nghỉ ĐÃ DUYỆT của chi nhánh trong một ngày (`workDate` `YYYY-MM-DD`); khung nghỉ là phút trong ngày giờ VN. */
  async listApprovedLeaves(tx: Prisma.TransactionClient, tenantId: string, branchId: string, workDate: string): Promise<Array<{ userId: string; startMinute: number; endMinute: number }>> {
    const rows = await tx.$queryRaw<Array<{ user_id: string; start_minute: number; end_minute: number }>>`
      SELECT user_id, start_minute, end_minute FROM leave_request
       WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid AND leave_date = ${workDate}::date AND status = 'APPROVED' AND deleted_at IS NULL`;
    return rows.map((r) => ({ userId: r.user_id, startMinute: r.start_minute, endMinute: r.end_minute }));
  }

  /** Số lượt khám đã tiếp nhận trong khoảng theo Loại tiếp nhận (chỉ các mã được hỏi). */
  async countEncountersByReceptionType(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date, codes: readonly string[]): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<Array<{ code: string; n: number }>>`
      SELECT e.reception_type_code AS code, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end} AND e.reception_type_code = ANY(${codes as string[]})
       GROUP BY 1`;
    return new Map(rows.map((r) => [r.code, r.n]));
  }

  /**
   * Hẹn tái khám: kế hoạch điều trị ĐÃ KÝ (còn hiệu lực) của lượt khám đã hoàn tất ở chi nhánh, có hướng "Hẹn tái khám" và ngày hẹn trong `[fromDate, today]`. "Đã quay lại" = bệnh nhân có
   * lượt khám đã tiếp nhận (mọi chi nhánh) sau lượt khám gốc. Đến hạn hôm nay = ngày hẹn là `today`; quá hạn = ngày hẹn trước `today` mà chưa quay lại.
   */
  async countFollowUps(tx: Prisma.TransactionClient, tenantId: string, branchId: string, today: string, fromDate: string, doctorId: string | null = null): Promise<FollowUpCounts> {
    const rows = await tx.$queryRaw<Array<{ due_today: number; arrived_today: number; overdue: number }>>`
      WITH f AS (
        SELECT p.follow_up_date AS d, e.id AS eid, e.patient_id, e.checked_in_at AS at
          FROM encounter_treatment_plan p
          JOIN encounter e ON e.tenant_id = p.tenant_id AND e.id = p.encounter_id
         WHERE p.tenant_id = ${tenantId}::uuid AND p.deleted_at IS NULL AND p.signed_at IS NOT NULL AND 'FOLLOW_UP' = ANY(p.directions::text[])
           AND p.follow_up_date >= ${fromDate}::date AND p.follow_up_date <= ${today}::date
           AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND e.status = 'COMPLETED'
           AND (${doctorId}::uuid IS NULL OR e.doctor_id = ${doctorId}::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM follow_up_reminder r
              WHERE r.tenant_id = e.tenant_id AND r.encounter_id = e.id AND r.result = 'NOT_RETURNING' AND r.deleted_at IS NULL)
      ), x AS (
        SELECT f.d,
               EXISTS (
                 SELECT 1 FROM encounter n
                  WHERE n.tenant_id = ${tenantId}::uuid AND n.patient_id = f.patient_id AND n.deleted_at IS NULL AND n.id <> f.eid
                    AND n.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED') AND n.checked_in_at > f.at
               ) AS returned
          FROM f
      )
      SELECT COUNT(*) FILTER (WHERE d = ${today}::date)::int AS due_today,
             COUNT(*) FILTER (WHERE d = ${today}::date AND returned)::int AS arrived_today,
             COUNT(*) FILTER (WHERE d < ${today}::date AND NOT returned)::int AS overdue
        FROM x`;
    const r = rows[0];
    return { dueToday: r?.due_today ?? 0, arrivedToday: r?.arrived_today ?? 0, overdueNotArrived: r?.overdue ?? 0 };
  }

  /** Lượt khám đã tiếp nhận theo ngày tiếp nhận. */
  async countEncountersByDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<DayCount[]> {
    const rows = await tx.$queryRaw<Array<{ d: string; n: number }>>`
      SELECT ${vnDay('e.checked_in_at')} AS d, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       GROUP BY 1`;
    return rows.map((r) => ({ date: r.d, count: r.n }));
  }

  /** Bệnh nhân khám lần đầu: lượt khám đầu tiên (mọi chi nhánh) của bệnh nhân rơi vào khoảng, tính theo ngày tiếp nhận. */
  async countNewPatientsByDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<DayCount[]> {
    const rows = await tx.$queryRaw<Array<{ d: string; n: number }>>`
      SELECT ${vnDay('e.checked_in_at')} AS d, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
         AND NOT EXISTS (
           SELECT 1 FROM encounter p
            WHERE p.tenant_id = e.tenant_id AND p.patient_id = e.patient_id AND p.deleted_at IS NULL
              AND p.status IN ('CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED')
              AND (p.checked_in_at < e.checked_in_at OR (p.checked_in_at = e.checked_in_at AND p.id < e.id)))
       GROUP BY 1`;
    return rows.map((r) => ({ date: r.d, count: r.n }));
  }

  async countEncountersByHour(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<Array<{ hour: number; count: number }>> {
    const rows = await tx.$queryRaw<Array<{ h: number; n: number }>>`
      SELECT ${vnHour('e.checked_in_at')} AS h, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       GROUP BY 1`;
    return rows.map((r) => ({ hour: r.h, count: r.n }));
  }

  /** Thực thu = tiền thu trừ tiền hoàn, nhóm theo NGÀY THU (`payment.paid_at`). */
  async sumCollectedByDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<Array<{ date: string; amount: number }>> {
    const rows = await tx.$queryRaw<Array<{ d: string; net: bigint }>>`
      SELECT ${vnDay('pay.paid_at')} AS d, COALESCE(SUM(CASE WHEN pay.type = 'PAYMENT' THEN pay.amount ELSE -pay.amount END), 0) AS net
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE pay.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${start} AND pay.paid_at < ${end}
       GROUP BY 1`;
    return rows.map((r) => ({ date: r.d, amount: Number(r.net) }));
  }

  /** Mỗi phiếu có thu/hoàn trong khoảng: số thực thu ròng của phiếu kèm các dòng (để chia vào nhóm doanh thu ở `@nexamed/core`). */
  async listCollectedWithLines(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<CollectedLineRow[]> {
    const rows = await tx.$queryRaw<
      Array<{
        invoice_id: string;
        net: bigint;
        line_total: bigint | null;
        discount_type: DiscountType | null;
        discount_value: bigint | null;
        source_service_item_id: string | null;
        source_stock_issue_line_id: string | null;
        source_order_item_id: string | null;
        source_order_package_id: string | null;
      }>
    >`
      WITH net AS (
        SELECT pay.invoice_id, SUM(CASE WHEN pay.type = 'PAYMENT' THEN pay.amount ELSE -pay.amount END) AS net
          FROM payment pay
          JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE pay.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
           AND pay.paid_at >= ${start} AND pay.paid_at < ${end}
         GROUP BY pay.invoice_id
      )
      SELECT n.invoice_id, n.net, l.line_total, l.discount_type, l.discount_value,
             l.source_service_item_id, l.source_stock_issue_line_id, l.source_order_item_id, l.source_order_package_id
        FROM net n
        LEFT JOIN invoice_line l ON l.tenant_id = ${tenantId}::uuid AND l.invoice_id = n.invoice_id AND l.deleted_at IS NULL
       WHERE n.net <> 0
       ORDER BY n.invoice_id`;
    return rows.map((r) => ({
      invoiceId: r.invoice_id,
      net: Number(r.net),
      lineTotal: r.line_total === null ? null : Number(r.line_total),
      discountType: r.discount_type,
      discountValue: r.discount_value === null ? null : Number(r.discount_value),
      sourceServiceItemId: r.source_service_item_id,
      sourceStockIssueLineId: r.source_stock_issue_line_id,
      sourceOrderItemId: r.source_order_item_id,
      sourceOrderPackageId: r.source_order_package_id,
    }));
  }

  /** Phiếu CHƯA THU của các lượt khám tiếp nhận trong khoảng, kèm dòng — `dueAmount` tính ở `@nexamed/core`. */
  listUnpaidInvoices(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<UnpaidInvoiceRow[]> {
    return this.listInvoicesWithLines(tx, tenantId, branchId, start, end, ['UNPAID'], null);
  }

  /** Phiếu chưa thu VÀ đã thu (không gồm đã huỷ/hoàn) của các lượt khám do MỘT bác sĩ khám trong khoảng, kèm dòng — cho ô "Doanh thu sinh ra" (#286). */
  listDoctorInvoices(tx: Prisma.TransactionClient, tenantId: string, branchId: string, doctorId: string, start: Date, end: Date): Promise<UnpaidInvoiceRow[]> {
    return this.listInvoicesWithLines(tx, tenantId, branchId, start, end, ['UNPAID', 'PAID'], doctorId);
  }

  private async listInvoicesWithLines(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    start: Date,
    end: Date,
    statuses: readonly string[],
    doctorId: string | null,
  ): Promise<UnpaidInvoiceRow[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<
        Array<{
          id: string;
          encounter_id: string;
          invoice_no: string;
          invoice_type: UnpaidInvoiceRow['invoiceType'];
          full_name: string;
          d: string;
          total_amount: bigint;
          discount_type: DiscountType | null;
          discount_value: bigint | null;
        }>
      >`
        SELECT i.id, e.id AS encounter_id, i.invoice_no, i.invoice_type, p.full_name, ${vnDay('e.checked_in_at')} AS d, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
          JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
         WHERE i.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND i.status::text = ANY(${statuses as string[]}::text[])
           AND (${doctorId}::uuid IS NULL OR e.doctor_id = ${doctorId}::uuid)
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
         ORDER BY e.checked_in_at ASC, i.created_at ASC, i.id ASC`,
      tx.$queryRaw<
        Array<{ invoice_id: string; exam_type_name: string; is_drug: boolean; line_total: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>
      >`
        SELECT l.invoice_id, l.exam_type_name, (l.source_stock_issue_line_id IS NOT NULL) AS is_drug, l.line_total, l.discount_type, l.discount_value
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND i.status::text = ANY(${statuses as string[]}::text[])
           AND (${doctorId}::uuid IS NULL OR e.doctor_id = ${doctorId}::uuid)
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, UnpaidInvoiceRow['lines']>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ name: l.exam_type_name, isDrug: l.is_drug, lineTotal: Number(l.line_total), discountType: l.discount_type, discountValue: l.discount_value === null ? null : Number(l.discount_value) });
      byInvoice.set(l.invoice_id, list);
    }
    return invoices.map((r) => ({
      invoiceId: r.id,
      encounterId: r.encounter_id,
      invoiceNo: r.invoice_no,
      invoiceType: r.invoice_type,
      patientName: r.full_name,
      date: r.d,
      totalAmount: Number(r.total_amount),
      discountType: r.discount_type,
      discountValue: r.discount_value === null ? null : Number(r.discount_value),
      lines: byInvoice.get(r.id) ?? [],
    }));
  }

  /**
   * Dòng dịch vụ (không gồm thuốc/vật tư) trên phiếu CHƯA HUỶ/chưa hoàn của các lượt khám trong khoảng, gộp theo (tên, giá trị, chiết khấu) để thu gọn số hàng trước khi
   * tính `net` từng dòng ở `@nexamed/core` (không lặp lại công thức làm tròn chiết khấu bằng SQL).
   */
  async listServiceLineGroups(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<ServiceLineGroup[]> {
    const rows = await tx.$queryRaw<
      Array<{ name: string; n: number; line_total: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>
    >`
      SELECT l.exam_type_name AS name, COUNT(*)::int AS n, l.line_total, l.discount_type, l.discount_value
        FROM invoice_line l
        JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND l.source_stock_issue_line_id IS NULL
         AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND i.status IN ('UNPAID', 'PAID')
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       GROUP BY l.exam_type_name, l.line_total, l.discount_type, l.discount_value`;
    return rows.map((r) => ({ name: r.name, count: r.n, lineTotal: Number(r.line_total), discountType: r.discount_type, discountValue: r.discount_value === null ? null : Number(r.discount_value) }));
  }

  /** Thanh toán (thu và hoàn) trong khoảng của chi nhánh, gộp theo (phương thức, loại, giờ thu VN) — theo NGÀY THU (`payment.paid_at`), cùng định nghĩa "thực thu" của Tổng quan chủ phòng khám. */
  async listPaymentGroups(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<PaymentGroupRow[]> {
    const rows = await tx.$queryRaw<Array<{ method: string; type: PaymentGroupRow['type']; h: number; n: number; amount: bigint }>>`
      SELECT pay.method, pay.type, ${vnHour('pay.paid_at')} AS h, COUNT(*)::int AS n, SUM(pay.amount) AS amount
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE pay.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${start} AND pay.paid_at < ${end}
       GROUP BY pay.method, pay.type, 3`;
    return rows.map((r) => ({ methodCode: r.method, type: r.type, hour: r.h, paymentCount: r.n, amount: Number(r.amount) }));
  }

  /** Số PHIẾU (không phải số lượt thanh toán) có thu và có hoàn trong khoảng — một phiếu thu nhiều lần chỉ đếm một. */
  async countInvoicesByPaymentType(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<{ collected: number; refunded: number }> {
    const rows = await tx.$queryRaw<Array<{ type: 'PAYMENT' | 'REFUND'; n: number }>>`
      SELECT pay.type, COUNT(DISTINCT pay.invoice_id)::int AS n
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE pay.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${start} AND pay.paid_at < ${end}
       GROUP BY pay.type`;
    return { collected: rows.find((r) => r.type === 'PAYMENT')?.n ?? 0, refunded: rows.find((r) => r.type === 'REFUND')?.n ?? 0 };
  }

  async listOpenCashierShifts(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<Array<{ label: string; openedAt: Date }>> {
    const rows = await tx.$queryRaw<Array<{ shift_label: string; opened_at: Date }>>`
      SELECT shift_label, opened_at FROM cashier_shift
       WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid AND status = 'OPEN' AND deleted_at IS NULL
       ORDER BY opened_at ASC`;
    return rows.map((r) => ({ label: r.shift_label, openedAt: r.opened_at }));
  }

  /** Số lô còn tồn sẽ hết hạn trong khoảng `[todayDate, todayDate + withinDays]` (ngày VN) ở kho của chi nhánh. */
  async countExpiringBatches(tx: Prisma.TransactionClient, tenantId: string, branchId: string, todayDate: string, untilDate: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT b.id)::int AS n
        FROM inventory_batch b
        JOIN warehouse w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
        JOIN stock_balance sb ON sb.tenant_id = b.tenant_id AND sb.batch_id = b.id AND sb.deleted_at IS NULL AND sb.quantity_on_hand > 0
       WHERE b.tenant_id = ${tenantId}::uuid AND b.deleted_at IS NULL AND w.branch_id = ${branchId}::uuid
         AND b.expiry_date IS NOT NULL AND b.expiry_date >= ${todayDate}::date AND b.expiry_date <= ${untilDate}::date`;
    return rows[0]?.n ?? 0;
  }

  /** Số mặt hàng đang dùng có ngưỡng cảnh báo mà tổng tồn ở kho của chi nhánh thấp hơn ngưỡng (`drug.min_stock_alert`). */
  async countBelowMinStock(tx: Prisma.TransactionClient, tenantId: string, branchId: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM (
        SELECT d.id
          FROM drug d
          LEFT JOIN stock_balance sb ON sb.tenant_id = d.tenant_id AND sb.drug_id = d.id AND sb.deleted_at IS NULL
                AND sb.warehouse_id IN (SELECT w.id FROM warehouse w WHERE w.tenant_id = d.tenant_id AND w.branch_id = ${branchId}::uuid)
         WHERE d.tenant_id = ${tenantId}::uuid AND d.deleted_at IS NULL AND d.is_active = true AND d.min_stock_alert IS NOT NULL
         GROUP BY d.id, d.min_stock_alert
        HAVING COALESCE(SUM(sb.quantity_on_hand), 0) < d.min_stock_alert
      ) t`;
    return rows[0]?.n ?? 0;
  }

  /** Hàng đợi hiện tại (lượt khám đang chờ/đang khám trong ngày) gộp theo bác sĩ, kèm phòng làm việc hôm nay của bác sĩ. Chưa có bác sĩ → một dòng "hàng chờ chung". */
  async listQueue(tx: Prisma.TransactionClient, tenantId: string, branchId: string, dayStart: Date, dayEnd: Date, workDate: string): Promise<QueueRow[]> {
    const rows = await tx.$queryRaw<
      Array<{ doctor_id: string | null; full_name: string | null; room_name: string | null; in_progress: number; waiting: number; oldest: Date | null }>
    >`
      SELECT e.doctor_id, u.full_name, r.name AS room_name,
             COUNT(*) FILTER (WHERE e.status = 'IN_CONSULTATION')::int AS in_progress,
             COUNT(*) FILTER (WHERE e.status = 'CHECKED_IN')::int AS waiting,
             MIN(e.checked_in_at) FILTER (WHERE e.status = 'CHECKED_IN') AS oldest
        FROM encounter e
        LEFT JOIN user_account u ON u.tenant_id = e.tenant_id AND u.id = e.doctor_id
        LEFT JOIN doctor_room_session s ON s.tenant_id = e.tenant_id AND s.doctor_id = e.doctor_id AND s.branch_id = e.branch_id AND s.work_date = ${workDate}::date AND s.deleted_at IS NULL
        LEFT JOIN room r ON r.tenant_id = s.tenant_id AND r.id = s.room_id
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL AND e.status IN ('CHECKED_IN', 'IN_CONSULTATION')
         AND e.checked_in_at >= ${dayStart} AND e.checked_in_at < ${dayEnd}
       GROUP BY e.doctor_id, u.full_name, r.name
       ORDER BY r.name NULLS LAST, u.full_name NULLS LAST`;
    return rows.map((r) => ({ doctorId: r.doctor_id, doctorName: r.full_name, roomName: r.room_name, inProgress: r.in_progress, waiting: r.waiting, oldestWaitingAt: r.oldest }));
  }
  // ----- Tổng quan bác sĩ (#286): mọi truy vấn lọc theo `doctor_id` = CHÍNH bác sĩ đăng nhập -----

  /** Lượt khám đã tiếp nhận hôm nay của MỘT bác sĩ, kèm bệnh nhân (tên, mã, ngày sinh) — một bác sĩ chỉ có vài chục lượt/ngày nên kéo về rồi tính ở `@nexamed/core`. */
  async listDoctorEncountersForDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, doctorId: string, start: Date, end: Date): Promise<DoctorEncounterInput[]> {
    const rows = await tx.$queryRaw<
      Array<{ id: string; status: DoctorEncounterInput['status']; checked_in_at: Date; started_at: Date | null; completed_at: Date | null; full_name: string; patient_code: string; dob: string | null }>
    >`
      SELECT e.id, e.status, e.checked_in_at, e.started_at, e.completed_at, p.full_name, p.patient_code, to_char(p.dob, 'YYYY-MM-DD') AS dob
        FROM encounter e
        JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.doctor_id = ${doctorId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       ORDER BY e.checked_in_at ASC, e.id ASC`;
    return rows.map((r) => ({ encounterId: r.id, status: r.status, checkedInAt: r.checked_in_at, startedAt: r.started_at, completedAt: r.completed_at, patientName: r.full_name, patientCode: r.patient_code, dob: r.dob }));
  }

  /** Số lượt khám đã tiếp nhận của MỘT bác sĩ theo ngày tiếp nhận (để tính trung bình mỗi ngày). */
  async countDoctorEncountersByDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, doctorId: string, start: Date, end: Date): Promise<DayCount[]> {
    const rows = await tx.$queryRaw<Array<{ d: string; n: number }>>`
      SELECT ${vnDay('e.checked_in_at')} AS d, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.doctor_id = ${doctorId}::uuid AND e.deleted_at IS NULL AND ${COUNTED_STATUSES}
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       GROUP BY 1`;
    return rows.map((r) => ({ date: r.d, count: r.n }));
  }

  /** Khoa của một nhân viên (`user_account.department_id`), `null` nếu chưa gán. */
  async getUserDepartmentId(tx: Prisma.TransactionClient, tenantId: string, userId: string): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ department_id: string | null }>>`
      SELECT department_id FROM user_account WHERE tenant_id = ${tenantId}::uuid AND id = ${userId}::uuid AND deleted_at IS NULL`;
    return rows[0]?.department_id ?? null;
  }

  /** Hàng chờ chung của một Khoa hôm nay: lượt đã tiếp nhận, chưa có bác sĩ nào nhận (đúng điều kiện "Nhận ca"). */
  async countCommonQueue(tx: Prisma.TransactionClient, tenantId: string, branchId: string, departmentId: string, start: Date, end: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.department_id = ${departmentId}::uuid AND e.doctor_id IS NULL
         AND e.status = 'CHECKED_IN' AND e.deleted_at IS NULL AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}`;
    return rows[0]?.n ?? 0;
  }

  /** Kết quả cận lâm sàng làm tại phòng khám đã duyệt mà bác sĩ CHƯA xem (`doctor_seen_at IS NULL`) của lượt khám do bác sĩ khám từ `start`; mới nhất trước, trả `limit` dòng đầu + tổng. */
  async listDoctorUnseenResults(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    doctorId: string,
    start: Date,
    end: Date,
    limit: number,
  ): Promise<{ total: number; items: Array<{ itemId: string; name: string; patientName: string; resultedAt: Date }> }> {
    const rows = await tx.$queryRaw<Array<{ id: string; name: string; full_name: string; resulted_at: Date; total: number }>>`
      SELECT i.id, i.name, p.full_name, i.updated_at AS resulted_at, COUNT(*) OVER ()::int AS total
        FROM clinical_order_item i
        JOIN clinical_order o ON o.tenant_id = i.tenant_id AND o.id = i.clinical_order_id
        JOIN encounter e ON e.tenant_id = o.tenant_id AND e.id = o.encounter_id
        JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
       WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL AND i.item_kind = 'TECHNICAL_SERVICE' AND i.performance = 'IN_HOUSE'
         AND i.status = 'COMPLETED' AND i.doctor_seen_at IS NULL AND o.deleted_at IS NULL
         AND e.branch_id = ${branchId}::uuid AND e.doctor_id = ${doctorId}::uuid AND e.deleted_at IS NULL
         AND e.status IN ('IN_CONSULTATION', 'COMPLETED') AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       ORDER BY i.updated_at DESC, i.id ASC
       LIMIT ${limit}`;
    return { total: rows[0]?.total ?? 0, items: rows.map((r) => ({ itemId: r.id, name: r.name, patientName: r.full_name, resultedAt: r.resulted_at })) };
  }

  /** Giá trị các chỉ số của kết quả ĐÃ KÝ còn hiệu lực (chưa bị thay bằng bản đính chính) của các dòng chỉ định, kèm khoảng tham chiếu đã chụp — để đếm chỉ số ngoài khoảng. */
  async listSignedResultValues(
    tx: Prisma.TransactionClient,
    tenantId: string,
    itemIds: readonly string[],
  ): Promise<Array<{ itemId: string; valueType: 'NUMBER' | 'TEXT' | 'CHOICE'; valueText: string | null; referenceSnapshot: unknown }>> {
    if (itemIds.length === 0) return [];
    const rows = await tx.$queryRaw<Array<{ item_id: string; value_type: 'NUMBER' | 'TEXT' | 'CHOICE'; value_text: string | null; reference_snapshot: unknown }>>`
      SELECT r.clinical_order_item_id AS item_id, v.value_type::text AS value_type, v.value_text, v.reference_snapshot
        FROM paraclinical_result r
        JOIN paraclinical_result_value v ON v.tenant_id = r.tenant_id AND v.result_id = r.id AND v.deleted_at IS NULL
       WHERE r.tenant_id = ${tenantId}::uuid AND r.clinical_order_item_id = ANY(${itemIds as string[]}::uuid[]) AND r.deleted_at IS NULL AND r.signed_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM paraclinical_result s WHERE s.tenant_id = r.tenant_id AND s.supersedes_id = r.id AND s.deleted_at IS NULL AND s.signed_at IS NOT NULL)`;
    return rows.map((x) => ({ itemId: x.item_id, valueType: x.value_type, valueText: x.value_text, referenceSnapshot: x.reference_snapshot }));
  }
}
