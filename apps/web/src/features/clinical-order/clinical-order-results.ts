import type { ClinicalOrderItemView } from '@nexamed/shared';

/** Tông màu `StatusBadge` — khai lại kiểu ở đây để file thuần logic (không kéo React) test được trực tiếp. */
export type ResultStatusTone = 'success' | 'warning' | 'accent';

export interface ResultStatus {
  label: string;
  tone: ResultStatusTone;
}

/**
 * Trạng thái hiển thị cho bác sĩ ở khối "Kết quả đã có của lượt khám này": có kết quả đã duyệt còn hiệu lực = "Đã có kết quả"; đang đính chính (kết quả cũ tạm KHÔNG dùng được,
 * docs/DECISIONS.md #215b) = "Đang đính chính"; còn lại (đã lấy mẫu/gọi vào phòng, đang nhập hoặc chờ duyệt) = "Đang thực hiện".
 */
export function resultStatusOf(item: Pick<ClinicalOrderItemView, 'amendmentPending' | 'resultReturnedAt'>): ResultStatus {
  if (item.amendmentPending) return { label: 'Đang đính chính', tone: 'accent' };
  if (item.resultReturnedAt !== null) return { label: 'Đã có kết quả', tone: 'success' };
  return { label: 'Đang thực hiện', tone: 'warning' };
}

/** Chỉ dòng LÀM TẠI phòng khám đã bắt đầu thực hiện mới có gì để báo (dòng còn "chỉ định" chưa vào việc thì chưa hiện, dòng ra ngoài không có kết quả trong hệ thống). */
export function selectItemsWithProgress(items: ClinicalOrderItemView[]): ClinicalOrderItemView[] {
  return items.filter(
    (i) => i.performance === 'IN_HOUSE' && (i.status === 'IN_PROGRESS' || i.status === 'RESULTED' || i.status === 'COMPLETED' || i.resultReturnedAt !== null || i.amendmentPending),
  );
}
