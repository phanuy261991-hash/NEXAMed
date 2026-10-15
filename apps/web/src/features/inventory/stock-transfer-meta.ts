import type {
  StockTransferRejectReceiptReason,
  StockTransferStatus,
  StockTransferSummary,
  StockTransferVarianceReason,
  StockTransferVarianceResolution,
} from '@nexamed/shared';
import type { StatusBadgeTone } from '../../shared/ui/StatusBadge';

/**
 * Nhãn/sắc thái trạng thái + lý do của "Điều chuyển kho" (Đợt 2 chi nhánh, docs/DECISIONS.md #233, mockup màn 4/4b) — DÙNG CHUNG
 * danh sách, trang chi tiết, bản in, báo cáo hao hụt để mọi nơi gọi cùng một tên.
 */
export const TRANSFER_STATUS_META: Record<StockTransferStatus, { label: string; tone: StatusBadgeTone }> = {
  DRAFT: { label: 'Nháp', tone: 'neutral' },
  IN_TRANSIT: { label: 'Đang vận chuyển', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  VARIANCE_PENDING: { label: 'Nhận có chênh lệch · chờ bên gửi xử lý', tone: 'warning' },
  RETURNING: { label: 'Từ chối nhận · đang hoàn trả', tone: 'accent' },
  RETURNED: { label: 'Đã hoàn trả', tone: 'info' },
};

/** Thứ tự hiển thị ở ô lọc "Trạng thái". */
export const TRANSFER_STATUS_ORDER: StockTransferStatus[] = ['DRAFT', 'IN_TRANSIT', 'VARIANCE_PENDING', 'RETURNING', 'COMPLETED', 'RETURNED', 'REJECTED'];

export const VARIANCE_REASON_LABEL: Record<StockTransferVarianceReason, string> = {
  SHORTAGE: 'Thiếu hàng',
  DAMAGED: 'Hư hỏng / ướt',
  EXPIRED: 'Hết hạn / cận date quá mức',
  WRONG_ITEM: 'Sai lô / sai hàng',
  OTHER: 'Khác',
};

export const REJECT_RECEIPT_REASON_LABEL: Record<StockTransferRejectReceiptReason, string> = {
  WRONG_ITEM: 'Sai hàng / không đặt',
  DAMAGED: 'Hư hỏng / ướt',
  EXPIRED: 'Hết hạn / cận date quá mức',
  OTHER: 'Khác',
};

export const VARIANCE_RESOLUTION_LABEL: Record<StockTransferVarianceResolution, string> = {
  RETURN_TO_SOURCE: 'Hàng đã về kho gửi',
  WRITE_OFF: 'Ghi hao hụt',
};

/**
 * Vai trò của chi nhánh đang làm việc với MỘT phiếu: bên GỬI (kho nguồn thuộc chi nhánh này) và/hoặc bên NHẬN (kho đích thuộc chi nhánh này).
 * Điều chuyển cùng chi nhánh → vừa gửi vừa nhận. Quyền chi tiết vẫn do máy chủ kiểm lại (Khoa/Phòng của đúng kho từng bước).
 */
export function transferSides(transfer: Pick<StockTransferSummary, 'fromBranchId' | 'toBranchId'>, currentBranchId: string | null): { isSender: boolean; isReceiver: boolean } {
  return { isSender: transfer.fromBranchId === currentBranchId, isReceiver: transfer.toBranchId === currentBranchId };
}

export type TransferNextAction = 'receive' | 'resolve' | 'confirm-return' | null;

/** Việc đang chờ chi nhánh đang làm việc xử lý trên phiếu này (null = không có việc nào). */
export function nextTransferAction(transfer: Pick<StockTransferSummary, 'status' | 'fromBranchId' | 'toBranchId'>, currentBranchId: string | null): TransferNextAction {
  const { isSender, isReceiver } = transferSides(transfer, currentBranchId);
  if (transfer.status === 'IN_TRANSIT' && isReceiver) return 'receive';
  if (transfer.status === 'VARIANCE_PENDING' && isSender) return 'resolve';
  if (transfer.status === 'RETURNING' && isSender) return 'confirm-return';
  return null;
}

export const TRANSFER_ACTION_LABEL: Record<Exclude<TransferNextAction, null>, string> = {
  receive: 'Xác nhận nhận hàng',
  resolve: 'Xử lý chênh lệch',
  'confirm-return': 'Xác nhận đã nhận lại hàng',
};

/** Phiếu "chờ bên gửi xử lý chênh lệch" quá bấy nhiêu ngày thì hiện nhãn "Quá hạn xử lý" (mockup Đợt 2; nhắc ngay ở danh sách, không có thông báo đẩy). */
export const VARIANCE_OVERDUE_DAYS = 7;

/**
 * Số ngày phiếu `VARIANCE_PENDING` đã chờ xử lý tính từ lúc kiểm nhận (`receivedAt`), nếu ĐÃ QUÁ hạn `VARIANCE_OVERDUE_DAYS` — `null` nếu chưa quá hạn / không ở trạng thái đó.
 * Tính theo mốc thời gian tuyệt đối (24 giờ = 1 ngày), `nowMs` truyền vào để test được.
 */
export function varianceOverdueDays(transfer: Pick<StockTransferSummary, 'status' | 'receivedAt'>, nowMs: number): number | null {
  if (transfer.status !== 'VARIANCE_PENDING' || !transfer.receivedAt) return null;
  const days = Math.floor((nowMs - new Date(transfer.receivedAt).getTime()) / 86_400_000);
  return days > VARIANCE_OVERDUE_DAYS ? days : null;
}
