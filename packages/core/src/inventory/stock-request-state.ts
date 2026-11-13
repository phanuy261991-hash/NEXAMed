/**
 * Trạng thái "Yêu cầu cấp hàng" (docs/DECISIONS.md #298) — hàm THUẦN, không phụ thuộc framework.
 *
 * Nguyên tắc: dòng yêu cầu chỉ LƯU quyết định của kho cấp (`fulfilStatus`); số đã cấp/đã nhận và trạng thái giao nhận SUY RA từ các dòng
 * phiếu điều chuyển liên kết, nên không bao giờ lệch khi kho cấp sửa/từ chối phiếu điều chuyển nháp. Trạng thái cả phiếu suy ra từ các dòng.
 */

export type StockRequestStatusValue = 'DRAFT' | 'SUBMITTED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'REJECTED' | 'CANCELLED' | 'WITHDRAWN';
export type StockRequestLineFulfil = 'PENDING' | 'WAITING_STOCK' | 'ALLOCATED' | 'REJECTED' | 'WITHDRAWN';
export type StockTransferStatusValue = 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED' | 'REJECTED' | 'VARIANCE_PENDING' | 'RETURNING' | 'RETURNED';

/** Giai đoạn giao nhận của một phiếu điều chuyển liên kết. `VOID` = bên gửi đã từ chối phiếu nháp → coi như không tồn tại. */
export type TransferPhase = 'DRAFT' | 'IN_TRANSIT' | 'VARIANCE_PENDING' | 'RETURNING' | 'DONE' | 'VOID';

export function transferPhase(status: StockTransferStatusValue): TransferPhase {
  switch (status) {
    case 'DRAFT':
      return 'DRAFT';
    case 'IN_TRANSIT':
      return 'IN_TRANSIT';
    case 'VARIANCE_PENDING':
      return 'VARIANCE_PENDING';
    case 'RETURNING':
      return 'RETURNING';
    case 'COMPLETED':
    case 'RETURNED':
      return 'DONE';
    case 'REJECTED':
      return 'VOID';
  }
}

/** Một dòng điều chuyển liên kết với dòng yêu cầu (đã kèm trạng thái phiếu cha). */
export interface LinkedTransferLine {
  transferStatus: StockTransferStatusValue;
  quantityShipped: number;
  /** `null` tới khi bên nhận kiểm nhận. */
  quantityReceived: number | null;
}

export interface StockRequestLineInput {
  fulfilStatus: StockRequestLineFulfil;
  requestedQty: number;
  transferLines: readonly LinkedTransferLine[];
}

export type StockRequestLineDisplayStatus =
  | 'PENDING' // chờ kho cấp xử lý
  | 'WAITING_STOCK' // chờ hàng về
  | 'REJECTED' // từ chối (có lý do)
  | 'WITHDRAWN' // bên xin đã rút
  | 'WILL_SUPPLY' // đã chuyển thành phiếu điều chuyển nháp, chưa giao
  | 'IN_TRANSIT' // đang giao
  | 'VARIANCE_PENDING' // nhận thiếu, chờ kho cấp xử lý chênh lệch
  | 'RETURNING' // bên xin từ chối nhận, hàng đang trả về
  | 'RECEIVED'; // đã nhận xong

export interface StockRequestLineProgress {
  status: StockRequestLineDisplayStatus;
  /** Tổng số đã chuyển thành phiếu điều chuyển (không tính phiếu nháp bị từ chối). */
  allocatedQty: number;
  /** Tổng số thực nhận đã được bên xin kiểm nhận. */
  receivedQty: number;
  /** Phần còn thiếu so với số xin (không âm). */
  remainingQty: number;
}

const PHASE_ORDER: TransferPhase[] = ['VARIANCE_PENDING', 'RETURNING', 'IN_TRANSIT', 'DRAFT', 'DONE'];

export function computeLineProgress(line: StockRequestLineInput): StockRequestLineProgress {
  let allocatedQty = 0;
  let receivedQty = 0;
  const phases = new Set<TransferPhase>();
  for (const tl of line.transferLines) {
    const phase = transferPhase(tl.transferStatus);
    if (phase === 'VOID') continue;
    allocatedQty += tl.quantityShipped;
    receivedQty += tl.quantityReceived ?? 0;
    phases.add(phase);
  }
  const remainingQty = Math.max(line.requestedQty - allocatedQty, 0);

  let status: StockRequestLineDisplayStatus;
  if (line.fulfilStatus === 'WITHDRAWN') status = 'WITHDRAWN';
  else if (line.fulfilStatus === 'REJECTED') status = 'REJECTED';
  else if (line.fulfilStatus === 'WAITING_STOCK') status = 'WAITING_STOCK';
  else if (line.fulfilStatus === 'PENDING') status = 'PENDING';
  else {
    const worst = PHASE_ORDER.find((p) => phases.has(p));
    status = worst === 'VARIANCE_PENDING' ? 'VARIANCE_PENDING' : worst === 'RETURNING' ? 'RETURNING' : worst === 'IN_TRANSIT' ? 'IN_TRANSIT' : worst === 'DRAFT' ? 'WILL_SUPPLY' : 'RECEIVED';
  }
  return { status, allocatedQty, receivedQty, remainingQty };
}

/** Phiếu đã có ít nhất một dòng được cấp (có phiếu điều chuyển hiệu lực). */
export function hasAllocation(lines: readonly StockRequestLineInput[]): boolean {
  return lines.some((l) => computeLineProgress(l).allocatedQty > 0);
}

/**
 * Trạng thái cả phiếu sau khi đã được tiếp nhận (ACCEPTED/IN_PROGRESS/COMPLETED/WITHDRAWN) — suy từ các dòng. Trạng thái trước tiếp nhận
 * (DRAFT/SUBMITTED) và các trạng thái đóng do hành động cả phiếu (REJECTED/CANCELLED) KHÔNG đổi ở đây.
 */
export function deriveStockRequestStatus(current: StockRequestStatusValue, lines: readonly StockRequestLineInput[]): StockRequestStatusValue {
  if (current !== 'ACCEPTED' && current !== 'IN_PROGRESS' && current !== 'COMPLETED' && current !== 'WITHDRAWN') return current;
  if (lines.length === 0) return current;
  if (lines.every((l) => l.fulfilStatus === 'WITHDRAWN')) return 'WITHDRAWN';

  const progress = lines.map((l) => ({ line: l, progress: computeLineProgress(l) }));
  const anyDecided = progress.some((p) => p.line.fulfilStatus !== 'PENDING' || p.progress.allocatedQty > 0);
  if (!anyDecided) return 'ACCEPTED';

  const open = progress.some((p) => p.line.fulfilStatus === 'PENDING' || p.line.fulfilStatus === 'WAITING_STOCK');
  if (open) return 'IN_PROGRESS';

  // Mọi dòng đã đóng (đã cấp/từ chối/rút): hoàn thành khi mọi dòng "đã cấp" đã nhận xong, không còn giao dở hay chờ xử lý chênh lệch.
  const settled = progress.every((p) => p.line.fulfilStatus !== 'ALLOCATED' || p.progress.status === 'RECEIVED');
  return settled ? 'COMPLETED' : 'IN_PROGRESS';
}

export interface RequesterActions {
  cancel: boolean;
  /** Sửa tự do cả phiếu (chỉ khi kho cấp chưa tiếp nhận). */
  edit: boolean;
  /** Thêm mặt hàng — kèm báo kho cấp khi đã tiếp nhận. */
  addLines: boolean;
  /** Rút dòng — kho đã tiếp nhận thì chỉ rút được dòng chưa có hàng; `onlyWaiting` = chỉ dòng đang chờ hàng về. */
  withdrawLines: boolean;
  withdrawOnlyWaiting: boolean;
  /** Nhắn bổ sung, đổi mức khẩn, đổi ngày cần. */
  message: boolean;
}

/** Ma trận "bên xin được làm gì" theo trạng thái (mockup màn 6b, #298 điểm 13). */
export function requesterActions(status: StockRequestStatusValue): RequesterActions {
  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
      return { cancel: true, edit: true, addLines: true, withdrawLines: true, withdrawOnlyWaiting: false, message: status === 'SUBMITTED' };
    case 'ACCEPTED':
      return { cancel: false, edit: false, addLines: true, withdrawLines: true, withdrawOnlyWaiting: false, message: true };
    case 'IN_PROGRESS':
      return { cancel: false, edit: false, addLines: false, withdrawLines: true, withdrawOnlyWaiting: true, message: true };
    default:
      return { cancel: false, edit: false, addLines: false, withdrawLines: false, withdrawOnlyWaiting: false, message: false };
  }
}

export interface SupplierActions {
  accept: boolean;
  /** Từ chối cả phiếu — chỉ khi chưa cấp/quyết định dòng nào. */
  rejectAll: boolean;
  /** Cấp / ghi quyết định từng dòng / Cấp tiếp. */
  allocate: boolean;
}

export function supplierActions(status: StockRequestStatusValue): SupplierActions {
  switch (status) {
    case 'SUBMITTED':
      return { accept: true, rejectAll: true, allocate: false };
    case 'ACCEPTED':
      return { accept: false, rejectAll: true, allocate: true };
    case 'IN_PROGRESS':
      return { accept: false, rejectAll: false, allocate: true };
    default:
      return { accept: false, rejectAll: false, allocate: false };
  }
}

export interface SupplyRoutingWarehouse {
  id: string;
  branchId: string;
}

/**
 * Kho cấp của một kho xin, suy ra theo cấp (#298 điểm 4) — người dùng không chọn tuỳ ý:
 *  - kho phụ của phòng ban (hoặc kho khác kho chính) → kho chính CÙNG chi nhánh;
 *  - kho chính của chi nhánh PHỤ → kho chính của chi nhánh chính;
 *  - kho chính của chi nhánh chính → không có cấp trên (`null`, chỉ còn đặt nhà cung cấp).
 */
export function resolveSupplyingWarehouseId(
  requesting: SupplyRoutingWarehouse,
  branchDefaultWarehouse: { id: string } | null,
  mainBranchDefaultWarehouse: SupplyRoutingWarehouse | null,
): string | null {
  if (branchDefaultWarehouse && branchDefaultWarehouse.id !== requesting.id) return branchDefaultWarehouse.id;
  if (mainBranchDefaultWarehouse && mainBranchDefaultWarehouse.branchId !== requesting.branchId) return mainBranchDefaultWarehouse.id;
  return null;
}

export interface WaitingLineForReadiness {
  requestId: string;
  /** Thời điểm lập phiếu — phiếu cũ được giữ chỗ tồn trước. */
  requestCreatedAt: Date | string;
  warehouseId: string;
  drugId: string;
  /** Phần còn thiếu của dòng (số xin trừ số đã đưa vào phiếu điều chuyển còn hiệu lực). */
  remainingQty: number;
}

/**
 * "Hàng đã về" có GIỮ CHỖ tồn theo thứ tự phiếu (chủ dự án chốt 13/11/2026): với mỗi cặp (kho cấp, mặt hàng), các dòng đang chờ hàng về được xếp từ phiếu cũ đến phiếu mới; mỗi dòng còn đủ tồn
 * (sau khi trừ phần đã giữ cho các dòng cũ hơn) thì phiếu của nó "đã về" và phần tồn đó được giữ lại, dòng sau chỉ thấy phần còn lại. Dòng chưa đủ tồn không giữ chỗ (không chặn dòng nhỏ hơn đến sau).
 * Trả tập mã phiếu có ít nhất một dòng đã đủ hàng.
 */
export function computeReadyRequestIds(lines: readonly WaitingLineForReadiness[], onHandByWarehouseDrug: ReadonlyMap<string, number>): Set<string> {
  const ordered = [...lines].sort((a, b) => {
    const diff = new Date(a.requestCreatedAt).getTime() - new Date(b.requestCreatedAt).getTime();
    return diff !== 0 ? diff : a.requestId.localeCompare(b.requestId);
  });
  const available = new Map<string, number>();
  const ready = new Set<string>();
  for (const line of ordered) {
    if (line.remainingQty <= 0) continue;
    const key = `${line.warehouseId}:${line.drugId}`;
    const left = available.get(key) ?? onHandByWarehouseDrug.get(key) ?? 0;
    if (left >= line.remainingQty) {
      ready.add(line.requestId);
      available.set(key, left - line.remainingQty);
    } else {
      available.set(key, left);
    }
  }
  return ready;
}
