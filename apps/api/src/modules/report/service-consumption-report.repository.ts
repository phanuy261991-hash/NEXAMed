import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConsumptionPackageItem, ConsumptionRevenueInvoice, ConsumptionRevenueLine, DiscountType } from '@nexamed/core';

/**
 * Truy vấn của báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9). SQL phẳng, CHỈ ĐỌC; mọi truy vấn lọc `tenant_id` và chi nhánh trong phạm vi (kho theo
 * `warehouse.branch_id` — hướng chi nhánh #231; phạm vi do `ReportBranchScopeService` giải quyết ở service). Chỉ phiếu tiêu hao ĐANG HIỆU LỰC (`POSTED`; phiếu đã đảo `VOIDED` không tính).
 * Ngày theo giờ Việt Nam: khoảng `[start, end)` đổi sẵn ở service. Chi phí = số lượng × giá vốn lô lúc xuất (`stock_issue_line.unit_cost`); phép chia/làm tròn ở `@nexamed/core`.
 */

export interface ServiceConsumptionRange {
  tenantId: string;
  branchIds: string[];
  start: Date;
  end: Date;
}

export interface ServiceConsumptionFilters {
  serviceKey?: string;
  doctorId?: string;
}

/** Khoá và tên của lượt dịch vụ: dòng chỉ định (kỹ thuật hoặc dịch vụ khám) hoặc dịch vụ khám chọn lúc tiếp nhận. */
const SERVICE_KEY = Prisma.raw(`CASE WHEN coi.id IS NOT NULL THEN
    CASE WHEN coi.technical_service_id IS NOT NULL THEN 'TECHNICAL_SERVICE:' || coi.technical_service_id::text ELSE 'EXAM_TYPE:' || COALESCE(coi.exam_type_code, '') END
  ELSE 'EXAM_TYPE:' || COALESCE(esi.exam_type_code, '') END`);
const SERVICE_NAME = Prisma.raw(`COALESCE(coi.name, esi.exam_type_name, 'Dịch vụ không rõ')`);

const FROM = Prisma.sql`
  FROM stock_issue si
  JOIN warehouse w ON w.tenant_id = si.tenant_id AND w.id = si.warehouse_id
  JOIN encounter e ON e.tenant_id = si.tenant_id AND e.id = si.encounter_id
  JOIN stock_issue_line sil ON sil.tenant_id = si.tenant_id AND sil.issue_id = si.id AND sil.deleted_at IS NULL
  LEFT JOIN clinical_order_item coi ON coi.tenant_id = si.tenant_id AND coi.id = si.clinical_order_item_id
  LEFT JOIN encounter_service_item esi ON esi.tenant_id = si.tenant_id AND esi.id = si.encounter_service_item_id`;

const baseWhere = (r: ServiceConsumptionRange) => Prisma.sql`
  si.tenant_id = ${r.tenantId}::uuid AND si.deleted_at IS NULL AND si.issue_type::text = 'SERVICE_CONSUMPTION' AND si.status::text = 'POSTED'
  AND w.branch_id = ANY(${r.branchIds}::uuid[]) AND si.occurred_at >= ${r.start} AND si.occurred_at < ${r.end}`;

const filterWhere = (f: ServiceConsumptionFilters) => Prisma.sql`
  ${f.serviceKey ? Prisma.sql`AND (${SERVICE_KEY}) = ${f.serviceKey}::text` : Prisma.empty}
  ${f.doctorId ? Prisma.sql`AND e.doctor_id = ${f.doctorId}::uuid` : Prisma.empty}`;

export interface ServiceOptionRaw {
  key: string;
  name: string;
}

export interface ServiceItemCostRaw {
  key: string;
  itemName: string;
  quantity: number;
  cost: number;
}

export interface ConsumptionEntryRaw {
  occurredAt: Date;
  branchId: string;
  patientCode: string;
  patientName: string;
  serviceName: string;
  itemsText: string;
  doctorId: string | null;
  performedBy: string | null;
  cost: number;
  /** Nguồn dòng hoá đơn của lượt để gắn doanh thu (#297 bổ sung 4). */
  orderItemId: string | null;
  serviceItemId: string | null;
  packageId: string | null;
}

/** Một lượt dịch vụ (một phiếu tiêu hao hiệu lực) với chi phí và nguồn dòng hoá đơn. */
export interface VisitRaw {
  issueId: string;
  key: string;
  name: string;
  branchId: string;
  cost: number;
  orderItemId: string | null;
  serviceItemId: string | null;
  packageId: string | null;
}

export interface RevenueInvoicesRaw {
  /** Phiếu còn hiệu lực (UNPAID/PAID) cùng đủ dòng. */
  active: ConsumptionRevenueInvoice[];
  /** Nguồn dòng thuộc phiếu đã huỷ hoặc hoàn tiền toàn phần. */
  inactiveOrderItemIds: Set<string>;
  inactiveServiceItemIds: Set<string>;
  inactivePackageIds: Set<string>;
}

export interface ItemCostRaw {
  drugId: string;
  name: string;
  itemType: 'MEDICINE' | 'SUPPLY';
  unitCode: string | null;
  quantity: number;
  cost: number;
}

export interface ItemServiceCostRaw {
  drugId: string;
  serviceKey: string;
  serviceName: string;
  cost: number;
}

@Injectable()
export class ServiceConsumptionReportRepository {
  /** Mọi dịch vụ có ghi tiêu hao trong kỳ (bỏ lọc dịch vụ/bác sĩ) — cho ô chọn "Dịch vụ". */
  async listServiceOptions(tx: Prisma.TransactionClient, r: ServiceConsumptionRange): Promise<ServiceOptionRaw[]> {
    const rows = await tx.$queryRaw<Array<{ key: string; name: string }>>`
      SELECT DISTINCT (${SERVICE_KEY}) AS key, (${SERVICE_NAME}) AS name
      ${FROM}
      WHERE ${baseWhere(r)}`;
    return rows;
  }

  /** Chi phí theo (dịch vụ, mặt hàng) — để chọn mặt hàng "dùng nhiều nhất" của từng dịch vụ. */
  async sumByServiceItem(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<ServiceItemCostRaw[]> {
    const rows = await tx.$queryRaw<Array<{ key: string; item_name: string; quantity: bigint; cost: bigint }>>`
      SELECT (${SERVICE_KEY}) AS key, d.name AS item_name,
             COALESCE(SUM(sil.quantity), 0)::bigint AS quantity,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY 1, d.id, d.name`;
    return rows.map((x) => ({ key: x.key, itemName: x.item_name, quantity: Number(x.quantity), cost: Number(x.cost) }));
  }

  /** Từng lượt dịch vụ của từng khách, mới nhất trước, tối đa `limit` dòng. */
  async listEntries(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters, limit: number): Promise<ConsumptionEntryRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ occurred_at: Date; branch_id: string; patient_code: string; patient_name: string; service_name: string; items_text: string; doctor_id: string | null; performed_by: string | null; cost: bigint; order_item_id: string | null; service_item_id: string | null; package_id: string | null }>
    >`
      SELECT si.occurred_at, w.branch_id, p.patient_code, p.full_name AS patient_name, (${SERVICE_NAME}) AS service_name,
             string_agg(d.name || ' ×' || sil.quantity::text, ', ' ORDER BY sil.created_at, d.name) AS items_text,
             e.doctor_id, si.performed_by,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost,
             si.clinical_order_item_id AS order_item_id, si.encounter_service_item_id AS service_item_id, coi.clinical_order_package_id AS package_id
      ${FROM}
      JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
      JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY si.id, si.occurred_at, w.branch_id, p.patient_code, p.full_name, (${SERVICE_NAME}), e.doctor_id, si.performed_by, si.clinical_order_item_id, si.encounter_service_item_id, coi.clinical_order_package_id
      ORDER BY si.occurred_at DESC, si.id
      LIMIT ${limit}`;
    return rows.map((x) => ({
      occurredAt: x.occurred_at,
      branchId: x.branch_id,
      patientCode: x.patient_code,
      patientName: x.patient_name,
      serviceName: x.service_name,
      itemsText: x.items_text,
      doctorId: x.doctor_id,
      performedBy: x.performed_by,
      cost: Number(x.cost),
      orderItemId: x.order_item_id,
      serviceItemId: x.service_item_id,
      packageId: x.package_id,
    }));
  }

  // ---- Doanh thu và lãi gộp dịch vụ, tab Theo vật tư (#297 bổ sung 4) ----

  /** Từng lượt dịch vụ (mỗi phiếu tiêu hao hiệu lực là một lượt) kèm chi phí và nguồn dòng hoá đơn để gắn doanh thu. */
  async listVisits(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<VisitRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ issue_id: string; key: string; name: string; branch_id: string; cost: bigint; order_item_id: string | null; service_item_id: string | null; package_id: string | null }>
    >`
      SELECT si.id AS issue_id, (${SERVICE_KEY}) AS key, (${SERVICE_NAME}) AS name, w.branch_id,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost,
             si.clinical_order_item_id AS order_item_id, si.encounter_service_item_id AS service_item_id, coi.clinical_order_package_id AS package_id
      ${FROM}
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY 1, 2, 3, 4, 6, 7, 8`;
    return rows.map((x) => ({
      issueId: x.issue_id,
      key: x.key,
      name: x.name,
      branchId: x.branch_id,
      cost: Number(x.cost),
      orderItemId: x.order_item_id,
      serviceItemId: x.service_item_id,
      packageId: x.package_id,
    }));
  }

  /**
   * Phiếu thu của các lượt dịch vụ cùng MỌI dòng của phiếu (cần đủ dòng để chia chiết khấu toàn phiếu). Phiếu UNPAID/PAID là phiếu còn hiệu lực; phiếu CANCELLED/REFUNDED trả riêng tập nguồn
   * để web ghi "Đã hoàn tiền". Lọc theo `tenant_id`; không lọc theo ngày vì doanh thu đi theo LƯỢT dịch vụ chứ không theo ngày khám của phiếu.
   */
  async listRevenueInvoices(tx: Prisma.TransactionClient, tenantId: string, refs: { orderItemIds: string[]; serviceItemIds: string[]; packageIds: string[] }): Promise<RevenueInvoicesRaw> {
    const empty: RevenueInvoicesRaw = { active: [], inactiveOrderItemIds: new Set(), inactiveServiceItemIds: new Set(), inactivePackageIds: new Set() };
    if (refs.orderItemIds.length === 0 && refs.serviceItemIds.length === 0 && refs.packageIds.length === 0) return empty;
    const heads = await tx.$queryRaw<Array<{ id: string; status: string; total_amount: bigint; discount_type: DiscountType | null; discount_value: bigint | null }>>`
      SELECT i.id, i.status::text AS status, i.total_amount, i.discount_type, i.discount_value
        FROM invoice i
       WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NULL
         AND i.id IN (
           SELECT l.invoice_id FROM invoice_line l
            WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL
              AND (l.source_order_item_id = ANY(${refs.orderItemIds}::uuid[]) OR l.source_service_item_id = ANY(${refs.serviceItemIds}::uuid[]) OR l.source_order_package_id = ANY(${refs.packageIds}::uuid[])))`;
    if (heads.length === 0) return empty;
    const lines = await tx.$queryRaw<
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
      SELECT l.invoice_id, l.line_total, l.discount_type, l.discount_value, l.source_service_item_id, l.source_stock_issue_line_id, l.source_order_item_id, l.source_order_package_id
        FROM invoice_line l
       WHERE l.tenant_id = ${tenantId}::uuid AND l.deleted_at IS NULL AND l.invoice_id = ANY(${heads.map((h) => h.id)}::uuid[])
       ORDER BY l.created_at ASC, l.id ASC`;
    const byInvoice = new Map<string, ConsumptionRevenueLine[]>();
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
    const result: RevenueInvoicesRaw = { active: [], inactiveOrderItemIds: new Set(), inactiveServiceItemIds: new Set(), inactivePackageIds: new Set() };
    for (const h of heads) {
      const invoiceLines = byInvoice.get(h.id) ?? [];
      if (h.status === 'UNPAID' || h.status === 'PAID') {
        result.active.push({ totalAmount: Number(h.total_amount), discountType: h.discount_type, discountValue: h.discount_value === null ? null : Number(h.discount_value), lines: invoiceLines });
      } else {
        for (const l of invoiceLines) {
          if (l.sourceOrderItemId) result.inactiveOrderItemIds.add(l.sourceOrderItemId);
          if (l.sourceServiceItemId) result.inactiveServiceItemIds.add(l.sourceServiceItemId);
          if (l.sourceOrderPackageId) result.inactivePackageIds.add(l.sourceOrderPackageId);
        }
      }
    }
    return result;
  }

  /** Các dịch vụ còn hiệu lực trong những gói đã cho, kèm giá niêm yết (đơn giá × số lượng) để chia tiền dòng gói. */
  async listPackageItems(tx: Prisma.TransactionClient, tenantId: string, packageIds: string[]): Promise<ConsumptionPackageItem[]> {
    if (packageIds.length === 0) return [];
    const rows = await tx.$queryRaw<Array<{ id: string; package_id: string; weight: bigint }>>`
      SELECT coi.id, coi.clinical_order_package_id AS package_id, (COALESCE(coi.unit_price, 0) * coi.quantity)::bigint AS weight
        FROM clinical_order_item coi
       WHERE coi.tenant_id = ${tenantId}::uuid AND coi.deleted_at IS NULL AND coi.status::text <> 'CANCELLED' AND coi.clinical_order_package_id = ANY(${packageIds}::uuid[])
       ORDER BY coi.sort_order ASC, coi.id ASC`;
    return rows.map((x) => ({ packageId: x.package_id, orderItemId: x.id, weight: Number(x.weight) }));
  }

  /** Số lượng và chi phí theo mặt hàng (tab Theo vật tư). */
  async sumByItem(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<ItemCostRaw[]> {
    const rows = await tx.$queryRaw<Array<{ drug_id: string; name: string; item_type: 'MEDICINE' | 'SUPPLY'; base_unit_code: string | null; quantity: bigint; cost: bigint }>>`
      SELECT d.id AS drug_id, d.name, d.item_type::text AS item_type, d.base_unit_code,
             COALESCE(SUM(sil.quantity), 0)::bigint AS quantity,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY d.id, d.name, d.item_type, d.base_unit_code`;
    return rows.map((x) => ({ drugId: x.drug_id, name: x.name, itemType: x.item_type, unitCode: x.base_unit_code, quantity: Number(x.quantity), cost: Number(x.cost) }));
  }

  /** Chi phí theo (mặt hàng, dịch vụ) — để biết mỗi mặt hàng dùng ở những dịch vụ nào. */
  async sumByItemService(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<ItemServiceCostRaw[]> {
    const rows = await tx.$queryRaw<Array<{ drug_id: string; key: string; name: string; cost: bigint }>>`
      SELECT d.id AS drug_id, (${SERVICE_KEY}) AS key, (${SERVICE_NAME}) AS name,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY 1, 2, 3`;
    return rows.map((x) => ({ drugId: x.drug_id, serviceKey: x.key, serviceName: x.name, cost: Number(x.cost) }));
  }
}
