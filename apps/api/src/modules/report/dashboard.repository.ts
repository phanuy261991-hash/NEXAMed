import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscountType } from '@nexamed/core';

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
  date: string;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: Array<{ lineTotal: number; discountType: DiscountType | null; discountValue: number | null }>;
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

@Injectable()
export class DashboardRepository {
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
  async listUnpaidInvoices(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<UnpaidInvoiceRow[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; d: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT i.id, ${vnDay('e.checked_in_at')} AS d, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE i.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND i.status = 'UNPAID'
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}`,
      tx.$queryRaw<Array<{ invoice_id: string; line_total: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT l.invoice_id, l.line_total, l.discount_type, l.discount_value
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND i.status = 'UNPAID'
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}`,
    ]);
    const byInvoice = new Map<string, UnpaidInvoiceRow['lines']>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ lineTotal: Number(l.line_total), discountType: l.discount_type, discountValue: l.discount_value === null ? null : Number(l.discount_value) });
      byInvoice.set(l.invoice_id, list);
    }
    return invoices.map((r) => ({
      invoiceId: r.id,
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
}
