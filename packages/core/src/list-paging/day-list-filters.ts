/**
 * Lọc theo tab, tìm kiếm và đếm cho hai danh sách trong ngày — chuyển từ web lên máy chủ khi danh sách được tải theo lô (docs/DECISIONS.md #251). Trước đây web tự đếm/lọc trên TOÀN BỘ
 * danh sách; nay máy chủ tính số của cả ngày một lần rồi chỉ trả một lô dòng, nên số trên thẻ KPI và tab không phụ thuộc số dòng đã tải. Quy tắc giữ NGUYÊN như bản web cũ
 * (`ReceptionListPage.tsx`/`InvoiceListPage.tsx`) để người dùng không thấy khác biệt. Hàm thuần, nhận kiểu cấu trúc tối thiểu để dùng cho mọi dòng có đủ trường.
 */

// ------------------------------------------------------------------ Bệnh nhân trong ngày (tiếp nhận)

/** `ACTIVE` = đang chờ khám hoặc đang khám — nguồn cho bảng "Tải theo Bác sĩ" (không cần cả ngày). */
export type ReceptionListTab = 'ALL' | 'WAITING' | 'IN_PROGRESS' | 'UNPAID' | 'DONE' | 'ACTIVE';

export interface ReceptionFilterable {
  fullName: string;
  encounterNo: string;
  patientCode: string;
  phone: string;
  status: string;
  invoiceStatus: string | null;
}

export function matchesReceptionTab(item: ReceptionFilterable, tab: ReceptionListTab): boolean {
  switch (tab) {
    case 'ALL':
      return true;
    case 'WAITING':
      return item.status === 'CHECKED_IN';
    case 'IN_PROGRESS':
      return item.status === 'IN_CONSULTATION';
    case 'UNPAID':
      return item.invoiceStatus === 'UNPAID';
    case 'DONE':
      return item.status === 'COMPLETED';
    case 'ACTIVE':
      return item.status === 'CHECKED_IN' || item.status === 'IN_CONSULTATION';
  }
}

/** Họ tên, mã lượt khám, mã bệnh nhân (không phân biệt hoa/thường) và số điện thoại; từ khoá rỗng khớp tất cả. */
export function matchesReceptionSearch(item: ReceptionFilterable, query: string | undefined): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') return true;
  return item.fullName.toLowerCase().includes(q) || item.encounterNo.toLowerCase().includes(q) || item.patientCode.toLowerCase().includes(q) || item.phone.includes(q);
}

export interface ReceptionDayCounts {
  /** Không tính lượt khám đã huỷ/không đến. */
  total: number;
  waiting: number;
  inProgress: number;
  unpaid: number;
  done: number;
  /** Đã huỷ + không đến. */
  cancelled: number;
}

/** Số liệu CẢ NGÀY cho dải thẻ KPI (không áp tab/tìm kiếm). */
export function computeReceptionDayCounts(items: readonly ReceptionFilterable[]): ReceptionDayCounts {
  const counts: ReceptionDayCounts = { total: 0, waiting: 0, inProgress: 0, unpaid: 0, done: 0, cancelled: 0 };
  for (const i of items) {
    const gone = i.status === 'CANCELLED' || i.status === 'NO_SHOW';
    if (gone) counts.cancelled += 1;
    else counts.total += 1;
    if (i.status === 'CHECKED_IN') counts.waiting += 1;
    if (i.status === 'IN_CONSULTATION') counts.inProgress += 1;
    if (i.invoiceStatus === 'UNPAID') counts.unpaid += 1;
    if (i.status === 'COMPLETED') counts.done += 1;
  }
  return counts;
}

export interface ReceptionTabCounts {
  /** Gồm cả lượt đã huỷ (đúng như bản web cũ: "Tất cả" = mọi dòng của ngày). */
  all: number;
  waiting: number;
  inProgress: number;
  unpaid: number;
  done: number;
}

/** Số trên các tab — truyền danh sách ĐÃ áp từ khoá tìm để tab hiển thị số khớp với từ khoá. */
export function computeReceptionTabCounts(items: readonly ReceptionFilterable[]): ReceptionTabCounts {
  const counts: ReceptionTabCounts = { all: items.length, waiting: 0, inProgress: 0, unpaid: 0, done: 0 };
  for (const i of items) {
    if (i.status === 'CHECKED_IN') counts.waiting += 1;
    if (i.status === 'IN_CONSULTATION') counts.inProgress += 1;
    if (i.invoiceStatus === 'UNPAID') counts.unpaid += 1;
    if (i.status === 'COMPLETED') counts.done += 1;
  }
  return counts;
}

// ------------------------------------------------------------------ Thu ngân

export type BillingListTab = 'UNPAID' | 'PAID' | 'ALL';

export interface BillingFilterable {
  invoiceNo: string;
  encounterNo: string;
  fullName: string;
  patientCode: string;
  status: string;
}

export function matchesBillingTab(item: BillingFilterable, tab: BillingListTab): boolean {
  if (tab === 'ALL') return true;
  return tab === 'UNPAID' ? item.status === 'UNPAID' : item.status === 'PAID';
}

/** Mã phiếu thu, mã lượt khám, họ tên, mã bệnh nhân (không phân biệt hoa/thường); từ khoá rỗng khớp tất cả. */
export function matchesBillingSearch(item: BillingFilterable, query: string | undefined): boolean {
  const q = (query ?? '').trim().toLowerCase();
  if (q === '') return true;
  return item.invoiceNo.toLowerCase().includes(q) || item.encounterNo.toLowerCase().includes(q) || item.fullName.toLowerCase().includes(q) || item.patientCode.toLowerCase().includes(q);
}

export interface BillingTabCounts {
  unpaid: number;
  paid: number;
  all: number;
}

/** Số trên 3 tab Thu ngân — truyền danh sách ĐÃ áp từ khoá tìm. */
export function computeBillingTabCounts(items: readonly BillingFilterable[]): BillingTabCounts {
  const counts: BillingTabCounts = { unpaid: 0, paid: 0, all: items.length };
  for (const i of items) {
    if (i.status === 'UNPAID') counts.unpaid += 1;
    else if (i.status === 'PAID') counts.paid += 1;
  }
  return counts;
}
