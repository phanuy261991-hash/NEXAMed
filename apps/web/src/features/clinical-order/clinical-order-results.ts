import type { ClinicalOrderItemView } from '@nexamed/shared';

/** Tông màu `StatusBadge` — khai lại kiểu ở đây để file thuần logic (không kéo React) test được trực tiếp. */
export type ResultStatusTone = 'success' | 'warning' | 'accent' | 'neutral';

export interface ResultStatus {
  label: string;
  tone: ResultStatusTone;
}

/**
 * Trạng thái hiển thị cho bác sĩ ở tab "Kết quả cận lâm sàng": có kết quả đã duyệt còn hiệu lực = "Đã có kết quả"; đang đính chính (kết quả cũ tạm KHÔNG dùng được,
 * docs/DECISIONS.md #215b) = "Đang đính chính"; đã lấy mẫu/gọi vào phòng, đang nhập hoặc chờ duyệt = "Đang thực hiện"; mới chỉ định (chưa thu tiền/chưa lấy mẫu) = "Chờ thực hiện".
 */
export function resultStatusOf(item: Pick<ClinicalOrderItemView, 'amendmentPending' | 'resultReturnedAt'> & { status?: ClinicalOrderItemView['status'] }): ResultStatus {
  if (item.amendmentPending) return { label: 'Đang đính chính', tone: 'accent' };
  if (item.resultReturnedAt !== null) return { label: 'Đã có kết quả', tone: 'success' };
  if (item.status === 'ORDERED') return { label: 'Chờ thực hiện', tone: 'neutral' };
  return { label: 'Đang thực hiện', tone: 'warning' };
}

/**
 * Các dòng của tab "Kết quả cận lâm sàng" (#221): mọi dịch vụ kỹ thuật LÀM TẠI phòng khám chưa bị huỷ — kể cả dòng mới chỉ định ("Chờ thực hiện") để khớp với nhãn "Chờ kết quả" ở
 * Hàng đợi khám (đếm cả dòng chưa lấy mẫu). Dịch vụ khám, dòng tự do và chỉ định ra ngoài không có kết quả trong hệ thống nên không hiện.
 */
export function selectResultItems(items: ClinicalOrderItemView[]): ClinicalOrderItemView[] {
  return items.filter((i) => i.performance === 'IN_HOUSE' && i.serviceKind !== null && i.status !== 'CANCELLED');
}
