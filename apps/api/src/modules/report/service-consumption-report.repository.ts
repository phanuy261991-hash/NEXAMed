import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

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

export interface ServiceCostRaw extends ServiceOptionRaw {
  visitCount: number;
  cost: number;
}

export interface ServiceItemCostRaw {
  key: string;
  itemName: string;
  quantity: number;
  cost: number;
}

export interface ConsumptionTotalsRaw {
  visitCount: number;
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

  /** Số lượt và chi phí theo dịch vụ. Mỗi phiếu thuộc đúng MỘT dịch vụ nên cộng các dòng ra tổng số lượt không bị đếm trùng. */
  async sumByService(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<ServiceCostRaw[]> {
    const rows = await tx.$queryRaw<Array<{ key: string; name: string; visit_count: number; cost: bigint }>>`
      SELECT (${SERVICE_KEY}) AS key, (${SERVICE_NAME}) AS name,
             COUNT(DISTINCT si.id)::int AS visit_count,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY 1, 2`;
    return rows.map((x) => ({ key: x.key, name: x.name, visitCount: x.visit_count, cost: Number(x.cost) }));
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

  /** Ba ô tổng đầu trang: số lượt (phiếu) và tổng chi phí vốn khớp bộ lọc. */
  async totals(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters): Promise<ConsumptionTotalsRaw> {
    const [row] = await tx.$queryRaw<Array<{ visit_count: number; cost: bigint }>>`
      SELECT COUNT(DISTINCT si.id)::int AS visit_count, COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      WHERE ${baseWhere(r)} ${filterWhere(f)}`;
    return { visitCount: row?.visit_count ?? 0, cost: Number(row?.cost ?? 0) };
  }

  /** Từng lượt dịch vụ của từng khách, mới nhất trước, tối đa `limit` dòng. */
  async listEntries(tx: Prisma.TransactionClient, r: ServiceConsumptionRange, f: ServiceConsumptionFilters, limit: number): Promise<ConsumptionEntryRaw[]> {
    const rows = await tx.$queryRaw<
      Array<{ occurred_at: Date; branch_id: string; patient_code: string; patient_name: string; service_name: string; items_text: string; doctor_id: string | null; performed_by: string | null; cost: bigint }>
    >`
      SELECT si.occurred_at, w.branch_id, p.patient_code, p.full_name AS patient_name, (${SERVICE_NAME}) AS service_name,
             string_agg(d.name || ' ×' || sil.quantity::text, ', ' ORDER BY sil.created_at, d.name) AS items_text,
             e.doctor_id, si.performed_by,
             COALESCE(SUM(sil.quantity * sil.unit_cost), 0)::bigint AS cost
      ${FROM}
      JOIN drug d ON d.tenant_id = sil.tenant_id AND d.id = sil.drug_id
      JOIN patient p ON p.tenant_id = e.tenant_id AND p.id = e.patient_id
      WHERE ${baseWhere(r)} ${filterWhere(f)}
      GROUP BY si.id, si.occurred_at, w.branch_id, p.patient_code, p.full_name, (${SERVICE_NAME}), e.doctor_id, si.performed_by
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
    }));
  }
}
