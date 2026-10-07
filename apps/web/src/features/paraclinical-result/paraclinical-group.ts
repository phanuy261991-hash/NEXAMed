import type { ParaclinicalQueueBucket, TechnicalServiceKind } from '@nexamed/shared';

/**
 * Nhóm menu Cận lâm sàng (docs/DECISIONS.md #215): "Xét nghiệm" và "CĐHA & Thăm dò chức năng". `apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared`/`@nexamed/core` (#073)
 * nên bảng này PHẢN CHIẾU `PARACLINICAL_GROUP_KINDS`/`PARACLINICAL_GROUP_PERMISSION_MODULE` ở `packages/core` (nguồn sự thật phía API).
 */
export type ParaclinicalGroup = 'lab' | 'imaging';

interface GroupMeta {
  /** Tên mục menu. */
  label: string;
  /** Module quyền (`lab_result` | `imaging_result`) — Xem / Nhập / Duyệt. */
  permissionModule: 'lab_result' | 'imaging_result';
  /** Đường dẫn hàng đợi; màn nhập kết quả là `${basePath}/items/:itemId`. */
  basePath: string;
  /** Tiêu đề ẩn (đọc màn hình) của trang hàng đợi. */
  queueTitle: string;
  /** Nhãn 2 tab khác nhau giữa 2 nhóm (xét nghiệm có bước lấy mẫu, CĐHA/thăm dò có bước gọi vào phòng). */
  bucketLabels: Record<ParaclinicalQueueBucket, string>;
  /** Nhãn nút chính của dòng "Chờ" ở hàng đợi. */
  startLabel: string;
}

export const PARACLINICAL_GROUP_META: Record<ParaclinicalGroup, GroupMeta> = {
  lab: {
    label: 'Xét nghiệm',
    permissionModule: 'lab_result',
    basePath: '/paraclinical/lab',
    queueTitle: 'Hàng đợi xét nghiệm',
    bucketLabels: {
      AWAITING_PAYMENT: 'Chờ thu tiền',
      WAITING: 'Chờ lấy mẫu',
      IN_PROGRESS: 'Đã lấy mẫu, đang thực hiện',
      PENDING_APPROVAL: 'Chờ duyệt kết quả',
      COMPLETED: 'Đã trả kết quả',
    },
    startLabel: 'Lấy mẫu',
  },
  imaging: {
    label: 'CĐHA & Thăm dò chức năng',
    permissionModule: 'imaging_result',
    basePath: '/paraclinical/imaging',
    queueTitle: 'Hàng đợi chẩn đoán hình ảnh và thăm dò chức năng',
    bucketLabels: {
      AWAITING_PAYMENT: 'Chờ thu tiền',
      WAITING: 'Chờ gọi vào phòng',
      IN_PROGRESS: 'Đang trong phòng',
      PENDING_APPROVAL: 'Chờ duyệt kết quả',
      COMPLETED: 'Đã trả kết quả',
    },
    startLabel: 'Gọi vào phòng',
  },
};

/** Loại dịch vụ → nhóm menu phục vụ nó. */
export function groupOfServiceKind(kind: TechnicalServiceKind): ParaclinicalGroup {
  return kind === 'LAB' ? 'lab' : 'imaging';
}
