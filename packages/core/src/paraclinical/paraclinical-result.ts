import { parseLabNumber, type LabIndicatorValueType } from '../lab/lab-reference';

/**
 * Logic thuần của Cận lâm sàng GĐ4 (docs/DECISIONS.md #212): suy ra tab hàng đợi, gộp xét nghiệm cùng phiếu thành 1 dòng, kiểm tra kết quả đã đủ để
 * gửi duyệt. Không phụ thuộc framework — API dùng ở service, bản web chỉ phản chiếu phần hiển thị (web không import `@nexamed/core`).
 */
export type ParaclinicalItemStatus = 'ORDERED' | 'IN_PROGRESS' | 'RESULTED' | 'COMPLETED' | 'CANCELLED';
export type ParaclinicalQueueBucket = 'AWAITING_PAYMENT' | 'WAITING' | 'IN_PROGRESS' | 'PENDING_APPROVAL' | 'COMPLETED';
export type ParaclinicalServiceKind = 'LAB' | 'IMAGING' | 'FUNCTIONAL';
export type ParaclinicalResultType = 'INDICATORS' | 'NARRATIVE' | 'BOTH';

export const PARACLINICAL_QUEUE_BUCKETS: readonly ParaclinicalQueueBucket[] = ['AWAITING_PAYMENT', 'WAITING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED'];

/**
 * Tab hàng đợi của một dòng chỉ định. Dòng `ORDERED` chưa thu tiền nằm ở "Chờ thu tiền" — trừ khi phòng khám bật "cho thực hiện trước khi thu tiền"
 * (đúng tiền lệ checkbox "Thanh toán sau" #080), khi đó vào thẳng "Chờ lấy mẫu / gọi vào phòng" (kèm nhãn "Nợ phí"). Dòng đã huỷ không có tab.
 */
export function deriveQueueBucket(status: ParaclinicalItemStatus, paid: boolean, allowBeforePayment: boolean): ParaclinicalQueueBucket | null {
  switch (status) {
    case 'ORDERED':
      return paid || allowBeforePayment ? 'WAITING' : 'AWAITING_PAYMENT';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'RESULTED':
      return 'PENDING_APPROVAL';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'CANCELLED':
      return null;
  }
}

export interface QueueGroupableItem {
  id: string;
  clinicalOrderId: string;
  serviceKind: ParaclinicalServiceKind;
  status: ParaclinicalItemStatus;
  paid: boolean;
}

/**
 * Gộp dòng chỉ định thành các dòng hàng đợi: xét nghiệm CÙNG PHIẾU, CÙNG trạng thái, CÙNG tình trạng thu tiền thành 1 nhóm (một lần lấy mẫu, một màn
 * nhập kết quả); mỗi dịch vụ chẩn đoán hình ảnh / thăm dò chức năng là 1 nhóm riêng. Giữ nguyên thứ tự xuất hiện của phần tử đầu mỗi nhóm.
 */
export function groupQueueItems<T extends QueueGroupableItem>(items: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.serviceKind === 'LAB' ? `${item.clinicalOrderId}|LAB|${item.status}|${item.paid ? 1 : 0}` : item.id;
    const existing = groups.get(key);
    if (existing) existing.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()];
}

export interface IndicatorValueToCheck {
  name: string;
  valueType: LabIndicatorValueType;
  choiceOptions: readonly string[];
  valueText: string | null | undefined;
}

export interface SectionToCheck {
  serviceName: string;
  resultType: ParaclinicalResultType;
  indicators: readonly IndicatorValueToCheck[];
  descriptionText: string | null | undefined;
  conclusionText: string | null | undefined;
}

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

/**
 * Kiểm tra kết quả đã ĐỦ để gửi duyệt / duyệt; trả về danh sách lỗi tiếng Việt (rỗng = đạt). Chỉ số dạng SỐ phải là số hợp lệ, dạng CHỌN phải thuộc danh
 * sách lựa chọn; kiểu INDICATORS/BOTH cần ít nhất một chỉ số có giá trị; kiểu NARRATIVE/BOTH cần cả mô tả lẫn kết luận. Bản NHÁP không phải kiểm.
 */
export function checkParaclinicalSectionComplete(section: SectionToCheck): string[] {
  const errors: string[] = [];
  const needsIndicators = section.resultType === 'INDICATORS' || section.resultType === 'BOTH';
  const needsNarrative = section.resultType === 'NARRATIVE' || section.resultType === 'BOTH';

  if (needsIndicators) {
    const filled = section.indicators.filter((i) => !blank(i.valueText));
    if (filled.length === 0) errors.push(`"${section.serviceName}": chưa nhập kết quả chỉ số nào.`);
    for (const indicator of filled) {
      const value = indicator.valueText as string;
      if (indicator.valueType === 'NUMBER' && parseLabNumber(value) === null) {
        errors.push(`"${section.serviceName}" — ${indicator.name}: "${value}" không phải số hợp lệ.`);
      }
      if (indicator.valueType === 'CHOICE' && !indicator.choiceOptions.includes(value)) {
        errors.push(`"${section.serviceName}" — ${indicator.name}: "${value}" không nằm trong danh sách lựa chọn.`);
      }
    }
  }
  if (needsNarrative) {
    if (blank(section.descriptionText)) errors.push(`"${section.serviceName}": chưa nhập mô tả.`);
    if (blank(section.conclusionText)) errors.push(`"${section.serviceName}": chưa nhập kết luận.`);
  }
  return errors;
}
