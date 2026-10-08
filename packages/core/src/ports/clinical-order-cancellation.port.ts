/**
 * Huỷ lượt khám → đóng các dòng chỉ định cận lâm sàng CHƯA BẮT ĐẦU (`ORDERED`) thành `CANCELLED` (docs/DECISIONS.md #219). `encounter` KHÔNG import thẳng `ClinicalOrderModule`
 * (`ClinicalOrderModule` đã import `EncounterModule` — import ngược sẽ thành vòng), nên đi qua port này; adapter thật đăng ký ở module `@Global()` riêng bên `clinical-order`,
 * cùng khuôn `StockAvailabilityPort`.
 *
 * KHÁC các port khác: việc này PHẢI nằm trong CÙNG transaction với việc huỷ lượt khám (đổi trạng thái lượt khám + đóng hoá đơn chưa thu + đóng dòng chỉ định là một khối
 * nguyên tử), nên `tx` được truyền vào. `packages/core` không biết Prisma nên `tx` là kiểu mờ (`unknown`) — chỉ adapter ở `apps/api` mới ép về `Prisma.TransactionClient`.
 */
export interface ClinicalOrderCancellationPort {
  /**
   * Chỉ dòng còn `ORDERED` (chưa lấy mẫu/gọi vào phòng) → `CANCELLED`. KHÔNG đụng dòng đang làm dở (`IN_PROGRESS`/`RESULTED`: mẫu đã lấy, việc đã làm) và dòng `COMPLETED`
   * (kết quả đã ký, bất biến). KHÔNG đụng hoá đơn/tiền (đã thu thì đi theo luồng hoàn tiền). Trả số dòng đã đóng.
   */
  cancelNotStartedItems(tx: unknown, tenantId: string, encounterId: string, actorId: string): Promise<number>;
}

export const CLINICAL_ORDER_CANCELLATION_PORT = Symbol('CLINICAL_ORDER_CANCELLATION_PORT');
