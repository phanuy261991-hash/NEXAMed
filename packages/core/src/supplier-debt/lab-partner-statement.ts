/**
 * Bảng kê mẫu xét nghiệm gửi đối tác (docs/DECISIONS.md #291, GĐ4) — phần TÍNH THUẦN: phân loại một dòng gửi, chọn mốc ngày để lọc kỳ, cộng tổng. Không biết gì về Prisma/HTTP;
 * máy chủ đọc dòng gửi rồi gọi các hàm này, nên bản in/Excel/màn hình luôn khớp nhau.
 */

export type LabPartnerStatementStatus = 'SENT' | 'RECEIVED' | 'REJECTED';

/** Trạng thái hiển thị trong bảng kê: đã có kết quả (đã ghi nợ) / chờ kết quả (chưa ghi nợ) / đối tác không nhận (0 đ). */
export type LabPartnerStatementState = 'DONE' | 'WAITING' | 'REJECTED';

/** Mốc ngày để tính kỳ: ngày nhận kết quả (mặc định, khớp ngày ghi nợ) hoặc ngày gửi. */
export type LabPartnerStatementBasis = 'RECEIVED' | 'SENT';

export interface LabPartnerStatementItemInput {
  status: LabPartnerStatementStatus;
  sentAt: Date;
  receivedAt: Date | null;
  /** Hạn trả = giờ gửi + "Thời gian trả kết quả" của dịch vụ; `null` khi dịch vụ chưa đặt. */
  dueAt: Date | null;
}

export interface LabPartnerStatementItemClass {
  state: LabPartnerStatementState;
  /** Đã có kết quả nhưng nhận sau hạn, hoặc còn chờ mà đã quá hạn. Đối tác không nhận không bao giờ "quá hạn". */
  late: boolean;
  /** Thời gian trả thực tế (phút) — chỉ có khi đã nhận kết quả. */
  turnaroundMinutes: number | null;
}

export function classifyLabPartnerStatementItem(item: LabPartnerStatementItemInput, now: Date): LabPartnerStatementItemClass {
  if (item.status === 'REJECTED') return { state: 'REJECTED', late: false, turnaroundMinutes: null };
  if (item.status === 'RECEIVED' && item.receivedAt) {
    const minutes = Math.max(0, Math.round((item.receivedAt.getTime() - item.sentAt.getTime()) / 60_000));
    return { state: 'DONE', late: item.dueAt !== null && item.receivedAt.getTime() > item.dueAt.getTime(), turnaroundMinutes: minutes };
  }
  return { state: 'WAITING', late: item.dueAt !== null && now.getTime() > item.dueAt.getTime(), turnaroundMinutes: null };
}

/**
 * Mốc ngày dùng để xếp dòng vào kỳ. Tính theo ngày NHẬN thì dòng chưa có ngày nhận (chờ kết quả, không nhận) rơi theo ngày GỬI để vẫn hiện trong bảng kê —
 * chúng không phát sinh nợ nên không làm lệch số tiền.
 */
export function labPartnerStatementDate(item: Pick<LabPartnerStatementItemInput, 'sentAt' | 'receivedAt'>, basis: LabPartnerStatementBasis): Date {
  return basis === 'RECEIVED' && item.receivedAt ? item.receivedAt : item.sentAt;
}

/** `from`/`to` là mốc UTC của đầu/cuối ngày (đã đổi từ ngày Việt Nam ở nơi gọi); bỏ trống = không giới hạn. */
export function isInLabPartnerStatementPeriod(date: Date, from: Date | null, to: Date | null): boolean {
  return (from === null || date.getTime() >= from.getTime()) && (to === null || date.getTime() <= to.getTime());
}

export type LabPartnerStatementStatusFilter = 'ALL' | 'DONE' | 'WAITING' | 'LATE' | 'REJECTED';

export function matchesLabPartnerStatementFilter(cls: Pick<LabPartnerStatementItemClass, 'state' | 'late'>, filter: LabPartnerStatementStatusFilter): boolean {
  if (filter === 'ALL') return true;
  if (filter === 'LATE') return cls.late;
  return cls.state === filter;
}

export interface LabPartnerStatementTotals {
  doneCount: number;
  /** Cộng giá trả của các mẫu ĐÃ CÓ KẾT QUẢ = số phát sinh công nợ. */
  doneAmount: number;
  waitingCount: number;
  /** Dự kiến — chưa ghi nợ. */
  waitingAmount: number;
  rejectedCount: number;
  /** Số dòng quá hạn (đã có kết quả trễ + đang chờ mà quá hạn). */
  lateCount: number;
}

export function summarizeLabPartnerStatement(rows: readonly { state: LabPartnerStatementState; late: boolean; unitCost: number }[]): LabPartnerStatementTotals {
  const totals: LabPartnerStatementTotals = { doneCount: 0, doneAmount: 0, waitingCount: 0, waitingAmount: 0, rejectedCount: 0, lateCount: 0 };
  for (const r of rows) {
    if (r.state === 'DONE') {
      totals.doneCount += 1;
      totals.doneAmount += r.unitCost;
    } else if (r.state === 'WAITING') {
      totals.waitingCount += 1;
      totals.waitingAmount += r.unitCost;
    } else {
      totals.rejectedCount += 1;
    }
    if (r.late) totals.lateCount += 1;
  }
  return totals;
}
