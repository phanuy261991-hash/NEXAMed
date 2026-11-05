import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscountType, RecognizedInvoiceInput } from '@nexamed/core';

/**
 * Nạp số liệu thô cho "Báo cáo ngày" (docs/DECISIONS.md #287). Các truy vấn dùng chung với Trang Tổng quan (số tiền thu theo phương thức, phiếu chưa thu, lượt khám theo Loại tiếp nhận)
 * nằm ở `DashboardRepository`; file này chỉ thêm bốn truy vấn riêng. Mọi truy vấn lọc `tenant_id` + `branch_id` của MỘT chi nhánh (hướng chi nhánh #231); chỗ gọi lặp theo từng chi nhánh
 * của phạm vi. Chỉ ĐỌC, không công thức tiền (chiết khấu và chia nhóm ở `@nexamed/core`).
 */

export interface RawDailyShift {
  shiftNo: string;
  label: string;
  cashierName: string;
  openedAt: Date;
  closedAt: Date | null;
  status: 'OPEN' | 'CLOSED' | 'APPROVED';
  expectedCash: number | null;
  countedCash: number | null;
}

@Injectable()
export class DailyReportRepository {
  /** Số lượt khám theo trạng thái, tính theo ngày tiếp nhận (`checked_in_at`). Gồm cả huỷ/không đến để báo cáo ngày hiện được. */
  async countEncountersByStatus(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<Array<{ status: string; n: number }>>`
      SELECT e.status::text AS status, COUNT(*)::int AS n
        FROM encounter e
       WHERE e.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND e.deleted_at IS NULL
         AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
       GROUP BY 1`;
    return new Map(rows.map((r) => [r.status, r.n]));
  }

  /**
   * Phiếu CHƯA HUỶ (chưa thu + đã thu) của các lượt khám tiếp nhận trong ngày, kèm dòng và nguồn của dòng — để tính doanh thu GHI NHẬN theo ngày khám và chia nhóm.
   * Hoàn tiền không trừ ở đây (nó hiện ở Thực thu theo ngày hoàn).
   */
  async listRecognizedInvoices(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<RecognizedInvoiceInput[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<Array<{ id: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
        SELECT i.id, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE i.tenant_id = ${tenantId}::uuid AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
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
         WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ${branchId}::uuid AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${start} AND e.checked_in_at < ${end}
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, RecognizedInvoiceInput['lines'][number][]>();
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
    return invoices.map((r) => ({
      totalAmount: Number(r.total_amount),
      discountType: r.discount_type,
      discountValue: r.discount_value === null ? null : Number(r.discount_value),
      lines: byInvoice.get(r.id) ?? [],
    }));
  }

  /** Các ca thu ngân MỞ trong ngày ở chi nhánh (kể cả ca còn đang mở), kèm tên người thu ngân. */
  async listShiftsOpenedInDay(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<RawDailyShift[]> {
    const rows = await tx.$queryRaw<
      Array<{
        shift_no: string;
        shift_label: string;
        full_name: string;
        opened_at: Date;
        closed_at: Date | null;
        status: RawDailyShift['status'];
        expected_cash_amount: bigint | null;
        counted_cash_amount: bigint | null;
      }>
    >`
      SELECT s.shift_no, s.shift_label, u.full_name, s.opened_at, s.closed_at, s.status::text AS status, s.expected_cash_amount, s.counted_cash_amount
        FROM cashier_shift s
        JOIN user_account u ON u.tenant_id = s.tenant_id AND u.id = s.cashier_id
       WHERE s.tenant_id = ${tenantId}::uuid AND s.branch_id = ${branchId}::uuid AND s.deleted_at IS NULL
         AND s.opened_at >= ${start} AND s.opened_at < ${end}
       ORDER BY s.opened_at ASC, s.id ASC`;
    return rows.map((r) => ({
      shiftNo: r.shift_no,
      label: r.shift_label,
      cashierName: r.full_name,
      openedAt: r.opened_at,
      closedAt: r.closed_at,
      status: r.status,
      expectedCash: r.expected_cash_amount === null ? null : Number(r.expected_cash_amount),
      countedCash: r.counted_cash_amount === null ? null : Number(r.counted_cash_amount),
    }));
  }

  /**
   * Phiếu thu/chi tại quầy (ngoài dịch vụ khám) đã GHI SỔ trong ngày, quỹ thuộc chi nhánh. Không gồm Chuyển quỹ (`counter_account_id`) — đó là di chuyển tiền nội bộ, không phải thu/chi thật
   * (cùng quy tắc Báo cáo dòng tiền). "Ngày phát sinh" của phiếu là ngày người dùng chọn, lưu ở nửa đêm UTC, nên so trong khoảng ngày VN như báo cáo dòng tiền.
   */
  async sumCounterVouchers(tx: Prisma.TransactionClient, tenantId: string, branchId: string, start: Date, end: Date): Promise<{ incomeAmount: number; expenseAmount: number }> {
    const rows = await tx.$queryRaw<Array<{ direction: 'INCOME' | 'EXPENSE'; total: bigint }>>`
      SELECT v.direction::text AS direction, COALESCE(SUM(v.amount), 0) AS total
        FROM cash_voucher v
        JOIN cash_account a ON a.tenant_id = v.tenant_id AND a.id = v.cash_account_id
       WHERE v.tenant_id = ${tenantId}::uuid AND a.branch_id = ${branchId}::uuid AND v.deleted_at IS NULL
         AND v.status::text = 'POSTED' AND v.counter_account_id IS NULL
         AND v.occurred_at >= ${start} AND v.occurred_at < ${end}
       GROUP BY 1`;
    const sum = (direction: 'INCOME' | 'EXPENSE') => Number(rows.find((r) => r.direction === direction)?.total ?? 0);
    return { incomeAmount: sum('INCOME'), expenseAmount: sum('EXPENSE') };
  }
}
