import { DomainError } from './domain-error';

/** Gỡ/đổi số lượng một dòng chỉ định khi tiền của dòng đó ĐÃ thu (hoặc dịch vụ đã được thực hiện, GĐ4) — phải xử lý bằng hoàn tiền/huỷ riêng. */
export class ClinicalOrderItemLockedError extends DomainError {
  readonly code = 'CLINICAL_ORDER_ITEM_LOCKED';

  constructor(itemName: string) {
    super(`"${itemName}" đã thu tiền hoặc đã thực hiện — không gỡ/đổi trực tiếp được. Hoàn tiền/huỷ ở màn Thu ngân trước.`);
  }
}

/** Dịch vụ làm tại phòng khám nhưng chưa khai đơn giá hiệu lực — không có số tiền để ghi vào hoá đơn. */
export class ClinicalOrderPriceMissingError extends DomainError {
  readonly code = 'CLINICAL_ORDER_PRICE_MISSING';

  constructor(itemName: string) {
    super(`"${itemName}" chưa có đơn giá hiệu lực — khai đơn giá ở Danh mục cận lâm sàng hoặc chỉ định ra ngoài.`);
  }
}

/** Dịch vụ đánh dấu "phòng khám không tự làm" mà chọn đường "Làm tại phòng khám". */
export class ClinicalOrderServiceNotInHouseError extends DomainError {
  readonly code = 'CLINICAL_ORDER_SERVICE_NOT_IN_HOUSE';

  constructor(itemName: string) {
    super(`"${itemName}" phòng khám không tự thực hiện — chỉ chỉ định được ra ngoài.`);
  }
}

/** Gói không dùng được hôm nay (đã ngừng/chưa tới hạn/hết hạn) hoặc không còn dịch vụ con nào hợp lệ. */
export class ClinicalOrderPackageNotOrderableError extends DomainError {
  readonly code = 'CLINICAL_ORDER_PACKAGE_NOT_ORDERABLE';

  constructor(packageName: string) {
    super(`Gói "${packageName}" hiện không dùng được (đã ngừng, ngoài thời gian hiệu lực hoặc chưa có giá).`);
  }
}
