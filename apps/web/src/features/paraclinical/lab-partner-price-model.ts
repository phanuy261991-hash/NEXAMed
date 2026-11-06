import type { LabPartnerPriceInput, LabPartnerPriceItem } from '@nexamed/shared';

/**
 * Giá trả đối tác theo dịch vụ (docs/DECISIONS.md #291) — phần thuần của form dịch vụ kỹ thuật: danh sách dòng (đối tác × giá trả), đối tác mặc định, kiểm tra và dựng dữ liệu gửi máy chủ.
 * Tách khỏi component để kiểm thử được; quy tắc khớp máy chủ (`TechnicalServiceService.savePartnerConfig`): mỗi đối tác một dòng, đúng một đối tác mặc định khi có dòng.
 */
export interface PartnerPriceRow {
  supplierId: string;
  code: string;
  name: string;
  /** `undefined` = chưa nhập. */
  amount: number | undefined;
  isDefault: boolean;
}

export function toPartnerRows(items: LabPartnerPriceItem[] | undefined): PartnerPriceRow[] {
  return (items ?? []).map((i) => ({ supplierId: i.supplierId, code: i.supplierCode, name: i.supplierName, amount: i.amount, isDefault: i.isDefault }));
}

/** Giữ đúng MỘT đối tác mặc định: không có thì dòng đầu là mặc định; nhiều hơn một thì chỉ giữ dòng mặc định đầu tiên. */
function normalizeDefault(rows: PartnerPriceRow[]): PartnerPriceRow[] {
  if (rows.length === 0) return rows;
  const first = rows.findIndex((r) => r.isDefault);
  const keep = first === -1 ? 0 : first;
  return rows.map((r, index) => (r.isDefault === (index === keep) ? r : { ...r, isDefault: index === keep }));
}

export function addPartnerRow(rows: PartnerPriceRow[], partner: { id: string; code: string; name: string }): PartnerPriceRow[] {
  if (rows.some((r) => r.supplierId === partner.id)) return rows;
  return normalizeDefault([...rows, { supplierId: partner.id, code: partner.code, name: partner.name, amount: undefined, isDefault: false }]);
}

export function removePartnerRow(rows: PartnerPriceRow[], supplierId: string): PartnerPriceRow[] {
  return normalizeDefault(rows.filter((r) => r.supplierId !== supplierId));
}

export function setDefaultPartner(rows: PartnerPriceRow[], supplierId: string): PartnerPriceRow[] {
  if (!rows.some((r) => r.supplierId === supplierId)) return rows;
  return rows.map((r) => ({ ...r, isDefault: r.supplierId === supplierId }));
}

export function setPartnerAmount(rows: PartnerPriceRow[], supplierId: string, amount: number | undefined): PartnerPriceRow[] {
  return rows.map((r) => (r.supplierId === supplierId ? { ...r, amount } : r));
}

/** Lỗi hiển thị dưới bảng giá trả; `null` = hợp lệ. `sentToPartner` bật thì phải có ít nhất một đối tác. */
export function validatePartnerRows(sentToPartner: boolean, rows: PartnerPriceRow[]): string | null {
  if (sentToPartner && rows.length === 0) return 'Chọn ít nhất một đối tác và nhập giá trả.';
  if (rows.some((r) => r.amount === undefined)) return 'Nhập giá trả cho mọi đối tác đã chọn.';
  return null;
}

/** Dữ liệu gửi máy chủ — chỉ gọi sau khi `validatePartnerRows` trả `null`. */
export function buildPartnerPayload(rows: PartnerPriceRow[]): LabPartnerPriceInput[] {
  return rows.map((r) => ({ supplierId: r.supplierId, amount: r.amount ?? 0, isDefault: r.isDefault }));
}

/** Lãi gộp một mẫu = giá bán cho khách trừ giá trả đối tác; `null` khi thiếu một trong hai số. */
export function partnerMargin(sellAmount: number | undefined, cost: number | undefined): number | null {
  if (sellAmount === undefined || cost === undefined) return null;
  return sellAmount - cost;
}
