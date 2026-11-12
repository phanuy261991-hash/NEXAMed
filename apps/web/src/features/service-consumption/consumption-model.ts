import type { ConsumptionService, DrugItemType, ServiceNormLine } from '@nexamed/shared';

/** Một dòng vật tư/thuốc đang soạn (định mức hoặc vật tư đã dùng). `quantity` giữ dạng chữ để gõ dở không bị ép số. */
export interface ConsumptionDraftLine {
  drugId: string;
  drugCode: string;
  drugName: string;
  itemType: DrugItemType;
  baseUnitCode: string | null;
  quantity: string;
}

/** Mặt hàng chọn từ ô tìm (rút gọn từ danh sách thuốc/vật tư). */
export interface ConsumptionPickItem {
  id: string;
  code: string;
  name: string;
  itemType: DrugItemType;
  baseUnitCode: string | null;
}

const MAX_QUANTITY = 1_000_000;
/** Khớp `MAX_CONSUMPTION_LINES` ở packages/shared (web chỉ import KIỂU từ shared). */
const MAX_LINES = 50;

/** Số lượng nguyên dương hợp lệ, ngược lại `null`. Số lượng luôn tính theo đơn vị CƠ SỞ của mặt hàng. */
export function parseQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 && n <= MAX_QUANTITY ? n : null;
}

/** Điền sẵn từ định mức của dịch vụ ("Điền theo định mức"). */
export function draftFromNorm(norm: ServiceNormLine[]): ConsumptionDraftLine[] {
  return norm.map((n) => ({ drugId: n.drugId, drugCode: n.drugCode, drugName: n.drugName, itemType: n.itemType, baseUnitCode: n.baseUnitCode, quantity: String(n.quantity) }));
}

/** Thêm một mặt hàng với số lượng 1; đã có dòng cùng mặt hàng thì giữ nguyên (mỗi mặt hàng một dòng). */
export function addDraftLine(lines: ConsumptionDraftLine[], item: ConsumptionPickItem): ConsumptionDraftLine[] {
  if (lines.some((l) => l.drugId === item.id)) return lines;
  return [...lines, { drugId: item.id, drugCode: item.code, drugName: item.name, itemType: item.itemType, baseUnitCode: item.baseUnitCode, quantity: '1' }];
}

export function removeDraftLine(lines: ConsumptionDraftLine[], drugId: string): ConsumptionDraftLine[] {
  return lines.filter((l) => l.drugId !== drugId);
}

export function updateDraftQuantity(lines: ConsumptionDraftLine[], drugId: string, quantity: string): ConsumptionDraftLine[] {
  return lines.map((l) => (l.drugId === drugId ? { ...l, quantity } : l));
}

/** Lỗi đầu tiên của danh sách (câu tiếng Việt) hoặc `null`. `allowEmpty`: định mức được để trống (= xoá hết), ghi tiêu hao thì không. */
export function validateDraftLines(lines: ConsumptionDraftLine[], options: { allowEmpty: boolean }): string | null {
  if (lines.length === 0) return options.allowEmpty ? null : 'Thêm ít nhất 1 vật tư hoặc thuốc.';
  if (lines.length > MAX_LINES) return `Tối đa ${MAX_LINES} dòng.`;
  const bad = lines.find((l) => parseQuantity(l.quantity) === null);
  if (bad) return `Số lượng của "${bad.drugName}" phải là số nguyên lớn hơn 0.`;
  return null;
}

/** Dòng gửi máy chủ — chỉ gọi sau khi `validateDraftLines` trả `null`. */
export function toRequestLines(lines: ConsumptionDraftLine[]): { drugId: string; quantity: number }[] {
  return lines.map((l) => ({ drugId: l.drugId, quantity: parseQuantity(l.quantity) ?? 0 }));
}

/** Hai danh sách giống nhau (cùng mặt hàng, cùng số lượng, không phân biệt thứ tự) — dùng để biết định mức có sửa hay chưa. */
export function sameDraftLines(a: ConsumptionDraftLine[], b: ConsumptionDraftLine[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((l) => [l.drugId, l.quantity.trim()]));
  return a.every((l) => byId.get(l.drugId) === l.quantity.trim());
}

/** Dịch vụ CÓ định mức mà CHƯA ghi vật tư đã dùng (để nhắc, không chặn). */
export function servicesMissingRecord(services: ConsumptionService[]): ConsumptionService[] {
  return services.filter((s) => s.norm.length > 0 && s.record === null);
}

/** Khoá ổn định của một lượt dịch vụ (chọn dịch vụ ở tab "Vật tư đã dùng"). */
export function consumptionTargetKey(target: ConsumptionService['target']): string {
  return `${target.kind}:${target.id}`;
}
