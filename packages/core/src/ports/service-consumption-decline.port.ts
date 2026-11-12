/**
 * "Khách không làm dịch vụ" × vật tư tiêu hao (docs/DECISIONS.md #297 GĐ4, màn 10): khi thu ngân bỏ một dịch vụ mà dịch vụ đó ĐÃ ghi vật tư đã dùng, hộp thoại phải cho biết
 * vật tư nào đã ghi và để người có quyền chọn GIỮ NGUYÊN hoặc ĐẢO PHIẾU + hoàn kho. `clinical-order` KHÔNG import `InventoryModule` (giữ ranh giới module), nên đi qua port này;
 * adapter thật đăng ký ở module `@Global()` riêng bên `inventory`, cùng khuôn `ClinicalOrderCancellationPort`.
 *
 * Giống `ClinicalOrderCancellationPort`: việc đảo phiếu PHẢI nằm trong CÙNG transaction với việc huỷ dịch vụ (đổi dòng chỉ định + tiền + hoàn kho là một khối nguyên tử), nên `tx`
 * được truyền vào. `packages/core` không biết Prisma nên `tx` là kiểu mờ (`unknown`). Adapter KHÔNG được tự mở transaction (#264).
 */
export interface DeclinedConsumptionLine {
  drugName: string;
  quantity: number;
  baseUnitCode: string | null;
}

/** Phiếu tiêu hao đang hiệu lực của MỘT dòng chỉ định. */
export interface ActiveServiceConsumption {
  orderItemId: string;
  /** Id phiếu xuất (`stock_issue`) loại tiêu hao. */
  issueId: string;
  issueNo: string;
  lines: DeclinedConsumptionLine[];
  /** Tổng giá vốn — `null` nếu người thao tác không có quyền xem giá vốn. */
  totalCost: number | null;
}

export interface ServiceConsumptionDeclinePort {
  /** Phiếu tiêu hao đang hiệu lực của các dòng chỉ định + người thao tác có quyền đảo phiếu hay không. Chỉ ĐỌC. */
  describeActive(tx: unknown, tenantId: string, branchId: string, actorId: string, orderItemIds: string[]): Promise<{ canReverse: boolean; items: ActiveServiceConsumption[] }>;
  /** Đảo MỘT phiếu tiêu hao (hoàn kho đúng lô) trong transaction của người gọi. Người gọi đã kiểm quyền đảo. */
  reverse(tx: unknown, tenantId: string, branchId: string, actorId: string, issueId: string, reason: string, meta: { ip: string | null; userAgent: string | null }): Promise<void>;
}

export const SERVICE_CONSUMPTION_DECLINE_PORT = Symbol('SERVICE_CONSUMPTION_DECLINE_PORT');
