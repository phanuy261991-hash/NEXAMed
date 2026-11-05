import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DatedInvoice, DatedPaymentTotal, DiscountType, ServiceInvoiceInput } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Doanh thu" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và `branch_id IN (phạm vi chi nhánh)` (hướng chi nhánh #231;
 * phạm vi do `ReportBranchScopeService` giải quyết ở service). KHÔNG tính tiền ở đây: chiết khấu và chia nhóm ở `@nexamed/core`. Ngày nhóm theo giờ Việt Nam (UTC+7 cố định, như các báo cáo khác).
 * Phiếu được nạp THEO ĐOẠN (một tháng lịch) để kỳ một năm không giữ hàng chục nghìn phiếu cùng lúc trong bộ nhớ.
 */

const vnDay = (column: string) => Prisma.raw(`to_char((${column} AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD')`);

export interface RevenueRange {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface MethodTotalRaw {
  methodCode: string;
  type: 'PAYMENT' | 'REFUND';
  paymentCount: number;
  amount: number;
}

export interface CashierPaymentRaw {
  userId: string;
  name: string;
  type: 'PAYMENT' | 'REFUND';
  paymentCount: number;
  amount: number;
}

export interface UnpaidInvoiceRaw {
  invoiceId: string;
  invoiceNo: string;
  invoiceType: 'SERVICE' | 'DRUG' | 'PARACLINICAL';
  patientCode: string;
  patientName: string;
  date: string;
  branchId: string;
  totalAmount: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  lines: Array<{ lineTotal: number; discountType: DiscountType | null; discountValue: number | null }>;
}

export interface ShiftRaw {
  shiftNo: string;
  label: string;
  cashierId: string;
  cashierName: string;
  branchId: string;
  openedAt: Date;
  closedAt: Date | null;
  status: 'OPEN' | 'CLOSED';
  expectedCash: number | null;
  countedCash: number | null;
}

type InvoiceHeadRow = { id: string; d: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null };

@Injectable()
export class RevenueReportRepository {
  /** Phiếu CHƯA HUỶ (chưa thu + đã thu) của các lượt khám tiếp nhận trong đoạn, kèm dòng — để tính GHI NHẬN theo ngày khám. Hoàn tiền không trừ ở đây (nó hiện ở Thực thu theo ngày hoàn). */
  async listRecognizedInvoices(tx: Prisma.TransactionClient, r: RevenueRange): Promise<DatedInvoice[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<InvoiceHeadRow[]>`
        SELECT i.id, ${vnDay('e.checked_in_at')} AS d, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE i.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
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
         WHERE l.tenant_id = ${r.tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, DatedInvoice['lines'][number][]>();
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
      date: i.d,
      totalAmount: Number(i.total_amount),
      discountType: i.discount_type,
      discountValue: i.discount_value === null ? null : Number(i.discount_value),
      lines: byInvoice.get(i.id) ?? [],
    }));
  }

  /** Như `listRecognizedInvoices` nhưng dòng có thêm mã, tên và số lượng dịch vụ — cho tab "Theo nhóm và dịch vụ". */
  async listServiceInvoices(tx: Prisma.TransactionClient, r: RevenueRange): Promise<ServiceInvoiceInput[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<InvoiceHeadRow[]>`
        SELECT i.id, ${vnDay('e.checked_in_at')} AS d, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE i.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
         ORDER BY i.id`,
      tx.$queryRaw<
        Array<{
          invoice_id: string;
          exam_type_code: string;
          exam_type_name: string;
          quantity: number;
          line_total: bigint;
          discount_type: DiscountType | null;
          discount_value: bigint | null;
          source_service_item_id: string | null;
          source_stock_issue_line_id: string | null;
          source_order_item_id: string | null;
          source_order_package_id: string | null;
        }>
      >`
        SELECT l.invoice_id, l.exam_type_code, l.exam_type_name, l.quantity, l.line_total, l.discount_type, l.discount_value,
               l.source_service_item_id, l.source_stock_issue_line_id, l.source_order_item_id, l.source_order_package_id
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE l.tenant_id = ${r.tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, ServiceInvoiceInput['lines'][number][]>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({
        code: l.exam_type_code,
        name: l.exam_type_name,
        quantity: l.quantity,
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
      totalAmount: Number(i.total_amount),
      discountType: i.discount_type,
      discountValue: i.discount_value === null ? null : Number(i.discount_value),
      lines: byInvoice.get(i.id) ?? [],
    }));
  }

  /** Tiền thu và hoàn theo (ngày thu VN, loại) — THỰC THU theo ngày thu (`payment.paid_at`). Kết quả nhỏ (tối đa 2 dòng mỗi ngày). */
  async sumPaymentsByDay(tx: Prisma.TransactionClient, r: RevenueRange): Promise<DatedPaymentTotal[]> {
    const rows = await tx.$queryRaw<Array<{ d: string; type: 'PAYMENT' | 'REFUND'; amount: bigint }>>`
      SELECT ${vnDay('pay.paid_at')} AS d, pay.type::text AS type, COALESCE(SUM(pay.amount), 0) AS amount
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE pay.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${r.start} AND pay.paid_at < ${r.end}
       GROUP BY 1, 2`;
    return rows.map((x) => ({ date: x.d, type: x.type, amount: Number(x.amount) }));
  }

  /** Tiền thu và hoàn theo (phương thức, loại) trong kỳ, kèm số lượt thanh toán. */
  async sumPaymentsByMethod(tx: Prisma.TransactionClient, r: RevenueRange): Promise<MethodTotalRaw[]> {
    const rows = await tx.$queryRaw<Array<{ method: string; type: 'PAYMENT' | 'REFUND'; n: number; amount: bigint }>>`
      SELECT pay.method, pay.type::text AS type, COUNT(*)::int AS n, COALESCE(SUM(pay.amount), 0) AS amount
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
       WHERE pay.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${r.start} AND pay.paid_at < ${r.end}
       GROUP BY 1, 2`;
    return rows.map((x) => ({ methodCode: x.method, type: x.type, paymentCount: x.n, amount: Number(x.amount) }));
  }

  /** Tiền thu và hoàn theo người ghi nhận thanh toán (`payment.created_by`) — "thu ngân" của từng khoản. */
  async sumPaymentsByCashier(tx: Prisma.TransactionClient, r: RevenueRange): Promise<CashierPaymentRaw[]> {
    const rows = await tx.$queryRaw<Array<{ user_id: string; full_name: string; type: 'PAYMENT' | 'REFUND'; n: number; amount: bigint }>>`
      SELECT pay.created_by AS user_id, COALESCE(u.full_name, 'Không rõ') AS full_name, pay.type::text AS type, COUNT(*)::int AS n, COALESCE(SUM(pay.amount), 0) AS amount
        FROM payment pay
        JOIN invoice i ON i.tenant_id = pay.tenant_id AND i.id = pay.invoice_id
        JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
        LEFT JOIN user_account u ON u.tenant_id = pay.tenant_id AND u.id = pay.created_by
       WHERE pay.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND pay.deleted_at IS NULL AND i.deleted_at IS NULL
         AND pay.paid_at >= ${r.start} AND pay.paid_at < ${r.end}
       GROUP BY 1, 2, 3`;
    return rows.map((x) => ({ userId: x.user_id, name: x.full_name, type: x.type, paymentCount: x.n, amount: Number(x.amount) }));
  }

  /**
   * Phiếu CHƯA THU của các lượt khám tiếp nhận trong kỳ, kèm dòng (để `dueAmount` tính ở `@nexamed/core`). Cũ nhất trước. Đọc đủ mọi phiếu chưa thu trong kỳ (kỳ tối đa 366 ngày, phiếu chưa thu
   * thường ít); service tự cắt danh sách hiển thị còn `REVENUE_UNPAID_ROW_LIMIT` dòng nhưng tổng số phiếu và tổng tiền luôn tính trên toàn bộ.
   */
  async listUnpaidInvoices(tx: Prisma.TransactionClient, r: RevenueRange): Promise<UnpaidInvoiceRaw[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<
        Array<{
          id: string;
          invoice_no: string;
          invoice_type: UnpaidInvoiceRaw['invoiceType'];
          patient_code: string;
          full_name: string;
          d: string;
          branch_id: string;
          total_amount: bigint;
          discount_type: DiscountType | null;
          discount_value: bigint | null;
        }>
      >`
        SELECT i.id, i.invoice_no, i.invoice_type::text AS invoice_type, p.patient_code, p.full_name, ${vnDay('e.checked_in_at')} AS d, e.branch_id, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
          JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
         WHERE i.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text = 'UNPAID'
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
         ORDER BY e.checked_in_at ASC, i.created_at ASC, i.id ASC`,
      tx.$queryRaw<Array<{ invoice_id: string; line_total: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT l.invoice_id, l.line_total, l.discount_type, l.discount_value
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE l.tenant_id = ${r.tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text = 'UNPAID'
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, UnpaidInvoiceRaw['lines']>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({ lineTotal: Number(l.line_total), discountType: l.discount_type, discountValue: l.discount_value === null ? null : Number(l.discount_value) });
      byInvoice.set(l.invoice_id, list);
    }
    return invoices.map((i) => ({
      invoiceId: i.id,
      invoiceNo: i.invoice_no,
      invoiceType: i.invoice_type,
      patientCode: i.patient_code,
      patientName: i.full_name,
      date: i.d,
      branchId: i.branch_id,
      totalAmount: Number(i.total_amount),
      discountType: i.discount_type,
      discountValue: i.discount_value === null ? null : Number(i.discount_value),
      lines: byInvoice.get(i.id) ?? [],
    }));
  }

  /** Các ca thu ngân MỞ trong kỳ ở các chi nhánh của phạm vi (kể cả ca còn đang mở), kèm tên người thu ngân; mới nhất trước. */
  async listShifts(tx: Prisma.TransactionClient, r: RevenueRange): Promise<ShiftRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{
        shift_no: string;
        shift_label: string;
        cashier_id: string;
        full_name: string;
        branch_id: string;
        opened_at: Date;
        closed_at: Date | null;
        status: string;
        expected_cash_amount: bigint | null;
        counted_cash_amount: bigint | null;
      }>
    >`
      SELECT s.shift_no, s.shift_label, s.cashier_id, u.full_name, s.branch_id, s.opened_at, s.closed_at, s.status::text AS status, s.expected_cash_amount, s.counted_cash_amount
        FROM cashier_shift s
        JOIN user_account u ON u.tenant_id = s.tenant_id AND u.id = s.cashier_id
       WHERE s.tenant_id = ${r.tenantId}::uuid AND s.branch_id = ANY(${r.branchIds}::uuid[]) AND s.deleted_at IS NULL
         AND s.opened_at >= ${r.start} AND s.opened_at < ${r.end}
       ORDER BY s.opened_at DESC, s.id DESC`;
    return rows.map((x) => ({
      shiftNo: x.shift_no,
      label: x.shift_label,
      cashierId: x.cashier_id,
      cashierName: x.full_name,
      branchId: x.branch_id,
      openedAt: x.opened_at,
      closedAt: x.status === 'OPEN' ? null : x.closed_at,
      status: x.status === 'OPEN' ? 'OPEN' : 'CLOSED',
      expectedCash: x.status === 'OPEN' || x.expected_cash_amount === null ? null : Number(x.expected_cash_amount),
      countedCash: x.status === 'OPEN' || x.counted_cash_amount === null ? null : Number(x.counted_cash_amount),
    }));
  }
}
