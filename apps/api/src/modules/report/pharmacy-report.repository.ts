import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { DiscountType, MarginInvoiceInput, MarginInvoiceLine, PharmacyItemFilter, PharmacyItemType } from '@nexamed/core';

/**
 * Truy vấn của trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287). SQL phẳng, CHỈ ĐỌC, mọi truy vấn lọc `tenant_id` và chi nhánh trong phạm vi (kho theo `warehouse.branch_id`, hoá đơn theo
 * `encounter.branch_id` — hướng chi nhánh #231; phạm vi do `ReportBranchScopeService` giải quyết ở service). KHÔNG tính tiền ở đây: chia chiết khấu và lãi gộp ở `@nexamed/core`.
 * Ngày theo giờ Việt Nam (UTC+7 cố định, như các báo cáo khác). Phiếu hoá đơn được nạp THEO ĐOẠN (một tháng lịch) để kỳ một năm không giữ cả năm trong bộ nhớ.
 */

const vnDay = (column: string) => Prisma.raw(`to_char((${column} AT TIME ZONE 'UTC') + interval '7 hours', 'YYYY-MM-DD')`);

export interface PharmacyRange {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface DispensedRaw {
  drugId: string;
  code: string;
  name: string;
  itemType: PharmacyItemType;
  unitCode: string | null;
  quantity: number;
  returnedQuantity: number;
  issueCount: number;
  /** Giá trị theo giá bán của thực phát (số lượng đã xuất trừ khách trả lại). */
  amount: number;
  returnedAmount: number;
}

export interface ControlledBalanceRaw {
  drugId: string;
  code: string;
  name: string;
  controlType: 'NARCOTIC' | 'PSYCHOTROPIC' | 'PRECURSOR' | 'TOXIC';
  unitCode: string | null;
  opening: number;
  received: number;
  dispensed: number;
  otherOut: number;
}

export interface ControlledEntryRaw {
  date: string;
  issueNo: string;
  drugCode: string;
  drugName: string;
  controlType: ControlledBalanceRaw['controlType'];
  unitCode: string | null;
  quantity: number;
  patientCode: string;
  patientName: string;
  branchId: string;
}

type InvoiceHeadRow = { id: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null };

/** Điều kiện chung: chỉ phiếu xuất BÁN THEO ĐƠN đã ghi sổ (đã huỷ không tính), của kho thuộc chi nhánh trong phạm vi. */
const retailIssueWhere = (r: PharmacyRange) => Prisma.sql`
  si.tenant_id = ${r.tenantId}::uuid AND si.deleted_at IS NULL AND si.issue_type::text = 'RETAIL_SALE' AND si.status::text = 'POSTED'
  AND w.branch_id = ANY(${r.branchIds}::uuid[]) AND si.occurred_at >= ${r.start} AND si.occurred_at < ${r.end}`;

@Injectable()
export class PharmacyReportRepository {
  /** Thuốc/vật tư đã phát theo mặt hàng: số lượng xuất, phần khách trả lại, số phiếu, giá trị theo giá bán. */
  async sumDispensed(tx: Prisma.TransactionClient, r: PharmacyRange, itemType: PharmacyItemFilter): Promise<DispensedRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ drug_id: string; code: string; name: string; item_type: PharmacyItemType; base_unit_code: string | null; qty: bigint; returned: bigint; issue_count: number; amount: bigint; returned_amount: bigint }>
    >`
      SELECT d.id AS drug_id, d.code, d.name, d.item_type::text AS item_type, d.base_unit_code,
             COALESCE(SUM(sil.quantity), 0)::bigint AS qty,
             COALESCE(SUM(x.returned), 0)::bigint AS returned,
             COUNT(DISTINCT si.id)::int AS issue_count,
             COALESCE(SUM((sil.quantity - x.returned) * sil.sell_price), 0)::bigint AS amount,
             COALESCE(SUM(x.returned * sil.sell_price), 0)::bigint AS returned_amount
        FROM stock_issue_line sil
        JOIN stock_issue si ON si.tenant_id = sil.tenant_id AND si.id = sil.issue_id
        JOIN warehouse w ON w.tenant_id = si.tenant_id AND w.id = si.warehouse_id
        JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
        CROSS JOIN LATERAL (
          SELECT COALESCE(SUM(rl.quantity), 0)::bigint AS returned
            FROM invoice_line il
            JOIN invoice_refund_line rl ON rl.tenant_id = il.tenant_id AND rl.invoice_line_id = il.id AND rl.deleted_at IS NULL
           WHERE il.tenant_id = sil.tenant_id AND il.source_stock_issue_line_id = sil.id AND il.deleted_at IS NULL
        ) x
       WHERE sil.tenant_id = ${r.tenantId}::uuid AND sil.deleted_at IS NULL AND ${retailIssueWhere(r)}
         AND (${itemType}::text = 'ALL' OR d.item_type::text = ${itemType}::text)
       GROUP BY d.id, d.code, d.name, d.item_type, d.base_unit_code`;
    return rows.map((x) => ({
      drugId: x.drug_id,
      code: x.code,
      name: x.name,
      itemType: x.item_type,
      unitCode: x.base_unit_code,
      quantity: Number(x.qty),
      returnedQuantity: Number(x.returned),
      issueCount: x.issue_count,
      amount: Number(x.amount),
      returnedAmount: Number(x.returned_amount),
    }));
  }

  /** Số phiếu xuất khác nhau có ít nhất một mặt hàng thuộc bộ lọc Loại (một phiếu nhiều mặt hàng chỉ đếm một lần). */
  async countDispensedIssues(tx: Prisma.TransactionClient, r: PharmacyRange, itemType: PharmacyItemFilter): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT si.id)::int AS n
        FROM stock_issue_line sil
        JOIN stock_issue si ON si.tenant_id = sil.tenant_id AND si.id = sil.issue_id
        JOIN warehouse w ON w.tenant_id = si.tenant_id AND w.id = si.warehouse_id
        JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
       WHERE sil.tenant_id = ${r.tenantId}::uuid AND sil.deleted_at IS NULL AND ${retailIssueWhere(r)}
         AND (${itemType}::text = 'ALL' OR d.item_type::text = ${itemType}::text)`;
    return rows[0]?.n ?? 0;
  }

  /**
   * Phiếu CHƯA HUỶ (chưa thu + đã thu) có ít nhất một dòng thuốc/vật tư, của các lượt khám tiếp nhận trong đoạn — kèm MỌI dòng (để chia chiết khấu), giá vốn snapshot của phiếu xuất và phần đã hoàn
   * một phần theo dòng. Cột Ghi nhận theo ngày khám, cùng quy tắc báo cáo Doanh thu.
   */
  async listMarginInvoices(tx: Prisma.TransactionClient, r: PharmacyRange): Promise<MarginInvoiceInput[]> {
    const [invoices, lines] = await Promise.all([
      tx.$queryRaw<InvoiceHeadRow[]>`
        SELECT i.id, i.total_amount, i.discount_type, i.discount_value
          FROM invoice i
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
         WHERE i.tenant_id = ${r.tenantId}::uuid AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
           AND EXISTS (SELECT 1 FROM invoice_line l2 WHERE l2.tenant_id = i.tenant_id AND l2.invoice_id = i.id AND l2.deleted_at IS NULL AND l2.source_stock_issue_line_id IS NOT NULL)
         ORDER BY i.id`,
      tx.$queryRaw<
        Array<{
          invoice_id: string;
          line_total: bigint;
          discount_type: DiscountType | null;
          discount_value: bigint | null;
          quantity: number;
          drug_id: string | null;
          code: string | null;
          name: string | null;
          item_type: PharmacyItemType | null;
          base_unit_code: string | null;
          unit_cost: bigint | null;
          refunded_quantity: bigint;
          refunded_amount: bigint;
          restocked_quantity: bigint;
        }>
      >`
        SELECT l.invoice_id, l.line_total, l.discount_type, l.discount_value, l.quantity,
               d.id AS drug_id, d.code, d.name, d.item_type::text AS item_type, d.base_unit_code, sil.unit_cost,
               COALESCE(rf.qty, 0)::bigint AS refunded_quantity, COALESCE(rf.amount, 0)::bigint AS refunded_amount, COALESCE(rf.restocked, 0)::bigint AS restocked_quantity
          FROM invoice_line l
          JOIN invoice i ON i.tenant_id = l.tenant_id AND i.id = l.invoice_id
          JOIN encounter e ON e.tenant_id = i.tenant_id AND e.id = i.encounter_id
          LEFT JOIN stock_issue_line sil ON sil.tenant_id = l.tenant_id AND sil.id = l.source_stock_issue_line_id
          LEFT JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
          LEFT JOIN LATERAL (
            SELECT SUM(rl.quantity) AS qty, SUM(rl.amount) AS amount, SUM(CASE WHEN rl.restocked THEN rl.quantity ELSE 0 END) AS restocked
              FROM invoice_refund_line rl
             WHERE rl.tenant_id = l.tenant_id AND rl.invoice_line_id = l.id AND rl.deleted_at IS NULL
          ) rf ON true
         WHERE l.tenant_id = ${r.tenantId}::uuid AND l.deleted_at IS NULL AND e.branch_id = ANY(${r.branchIds}::uuid[]) AND i.deleted_at IS NULL AND e.deleted_at IS NULL
           AND i.status::text IN ('UNPAID', 'PAID')
           AND e.checked_in_at >= ${r.start} AND e.checked_in_at < ${r.end}
           AND EXISTS (SELECT 1 FROM invoice_line l2 WHERE l2.tenant_id = i.tenant_id AND l2.invoice_id = i.id AND l2.deleted_at IS NULL AND l2.source_stock_issue_line_id IS NOT NULL)
         ORDER BY l.created_at ASC, l.id ASC`,
    ]);
    const byInvoice = new Map<string, MarginInvoiceLine[]>();
    for (const l of lines) {
      const list = byInvoice.get(l.invoice_id) ?? [];
      list.push({
        lineTotal: Number(l.line_total),
        discountType: l.discount_type,
        discountValue: l.discount_value === null ? null : Number(l.discount_value),
        drug: l.drug_id === null ? null : { drugId: l.drug_id, code: l.code ?? '', name: l.name ?? '', itemType: l.item_type ?? 'MEDICINE', unitCode: l.base_unit_code },
        quantity: l.quantity,
        unitCost: l.unit_cost === null ? 0 : Number(l.unit_cost),
        refundedQuantity: Number(l.refunded_quantity),
        refundedAmount: Number(l.refunded_amount),
        restockedQuantity: Number(l.restocked_quantity),
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

  /** Tồn đầu kỳ và biến động trong kỳ của các thuốc kiểm soát đặc biệt, cộng mọi kho thuộc phạm vi chi nhánh. Chỉ thuốc (không phải vật tư). */
  async listControlledBalances(tx: Prisma.TransactionClient, r: PharmacyRange, controlType: string): Promise<ControlledBalanceRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ drug_id: string; code: string; name: string; control_type: ControlledBalanceRaw['controlType']; base_unit_code: string | null; opening: bigint; received: bigint; dispensed: bigint; other_out: bigint }>
    >`
      SELECT d.id AS drug_id, d.code, d.name, d.control_type::text AS control_type, d.base_unit_code,
             COALESCE(SUM(CASE WHEN sl.occurred_at < ${r.start} THEN sl.quantity_change END), 0)::bigint AS opening,
             COALESCE(SUM(CASE WHEN sl.occurred_at >= ${r.start} AND sl.quantity_change > 0 THEN sl.quantity_change END), 0)::bigint AS received,
             COALESCE(SUM(CASE WHEN sl.occurred_at >= ${r.start} AND sl.quantity_change < 0 AND sl.reason::text = 'ISSUE_RETAIL_SALE' THEN -sl.quantity_change END), 0)::bigint AS dispensed,
             COALESCE(SUM(CASE WHEN sl.occurred_at >= ${r.start} AND sl.quantity_change < 0 AND sl.reason::text <> 'ISSUE_RETAIL_SALE' THEN -sl.quantity_change END), 0)::bigint AS other_out
        FROM drug d
        JOIN stock_ledger sl ON sl.tenant_id = d.tenant_id AND sl.drug_id = d.id AND sl.deleted_at IS NULL AND sl.occurred_at < ${r.end}
        JOIN warehouse w ON w.tenant_id = sl.tenant_id AND w.id = sl.warehouse_id
       WHERE d.tenant_id = ${r.tenantId}::uuid AND d.deleted_at IS NULL AND d.item_type::text = 'MEDICINE' AND d.control_type::text <> 'NORMAL'
         AND (${controlType}::text = 'ALL' OR d.control_type::text = ${controlType}::text)
         AND w.branch_id = ANY(${r.branchIds}::uuid[])
       GROUP BY d.id, d.code, d.name, d.control_type, d.base_unit_code`;
    return rows.map((x) => ({
      drugId: x.drug_id,
      code: x.code,
      name: x.name,
      controlType: x.control_type,
      unitCode: x.base_unit_code,
      opening: Number(x.opening),
      received: Number(x.received),
      dispensed: Number(x.dispensed),
      otherOut: Number(x.other_out),
    }));
  }

  /** Từng lượt phát thuốc kiểm soát đặc biệt cho người bệnh (phiếu xuất bán theo đơn), mới nhất trước; đọc `limit` dòng. */
  async listControlledEntries(tx: Prisma.TransactionClient, r: PharmacyRange, controlType: string, limit: number): Promise<ControlledEntryRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ d: string; issue_no: string; code: string; name: string; control_type: ControlledEntryRaw['controlType']; base_unit_code: string | null; quantity: number; patient_code: string; full_name: string; branch_id: string }>
    >`
      SELECT ${vnDay('si.occurred_at')} AS d, si.issue_no, d.code, d.name, d.control_type::text AS control_type, d.base_unit_code, sil.quantity,
             p.patient_code, p.full_name, w.branch_id
        FROM stock_issue_line sil
        JOIN stock_issue si ON si.tenant_id = sil.tenant_id AND si.id = sil.issue_id
        JOIN warehouse w ON w.tenant_id = si.tenant_id AND w.id = si.warehouse_id
        JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
        JOIN prescription pr ON pr.tenant_id = si.tenant_id AND pr.id = si.prescription_id
        JOIN encounter e ON e.tenant_id = pr.tenant_id AND e.id = pr.encounter_id
        JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
       WHERE sil.tenant_id = ${r.tenantId}::uuid AND sil.deleted_at IS NULL AND ${retailIssueWhere(r)}
         AND d.item_type::text = 'MEDICINE' AND d.control_type::text <> 'NORMAL'
         AND (${controlType}::text = 'ALL' OR d.control_type::text = ${controlType}::text)
       ORDER BY si.occurred_at DESC, si.id DESC, sil.id DESC
       LIMIT ${limit}`;
    return rows.map((x) => ({
      date: x.d,
      issueNo: x.issue_no,
      drugCode: x.code,
      drugName: x.name,
      controlType: x.control_type,
      unitCode: x.base_unit_code,
      quantity: x.quantity,
      patientCode: x.patient_code,
      patientName: x.full_name,
      branchId: x.branch_id,
    }));
  }

  /** Tổng số lượt phát thuốc kiểm soát đặc biệt trong kỳ (để biết danh sách chi tiết có bị cắt không). */
  async countControlledEntries(tx: Prisma.TransactionClient, r: PharmacyRange, controlType: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n
        FROM stock_issue_line sil
        JOIN stock_issue si ON si.tenant_id = sil.tenant_id AND si.id = sil.issue_id
        JOIN warehouse w ON w.tenant_id = si.tenant_id AND w.id = si.warehouse_id
        JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
       WHERE sil.tenant_id = ${r.tenantId}::uuid AND sil.deleted_at IS NULL AND ${retailIssueWhere(r)}
         AND d.item_type::text = 'MEDICINE' AND d.control_type::text <> 'NORMAL'
         AND (${controlType}::text = 'ALL' OR d.control_type::text = ${controlType}::text)`;
    return rows[0]?.n ?? 0;
  }
}
