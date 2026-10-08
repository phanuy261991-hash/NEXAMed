import { stripVietnameseDiacritics } from '../search/strip-vietnamese-diacritics';

/**
 * Đọc giá trị ô Excel của "Nhập Excel Thuốc & Vật tư" (docs/DECISIONS.md #210) — hàm THUẦN (không
 * Excel/DB/framework) nên test được độc lập; phía API chỉ lo đọc file rồi đưa chuỗi/số thô vào đây.
 * Mọi hàm `parse*` trả `{ ok: true, value }` (ô trống → `value = null`, người gọi tự áp mặc định) hoặc
 * `{ ok: false }` (giá trị có nhưng sai định dạng → người gọi báo lỗi dòng).
 */
export type ImportParseResult<T> = { ok: true; value: T | null } | { ok: false };

export type ImportItemType = 'MEDICINE' | 'SUPPLY';
export type ImportControlType = 'NORMAL' | 'TOXIC' | 'NARCOTIC' | 'PSYCHOTROPIC' | 'PRECURSOR';

/** Nhãn tiếng Việt dùng cho file mẫu/xuất Excel và đọc ngược lại — MỘT nơi, mẫu và bộ đọc không lệch nhau. */
export const IMPORT_ITEM_TYPE_LABELS: Record<ImportItemType, string> = { MEDICINE: 'Thuốc', SUPPLY: 'Vật tư' };
export const IMPORT_CONTROL_TYPE_LABELS: Record<ImportControlType, string> = {
  NORMAL: 'Thường',
  TOXIC: 'Độc',
  NARCOTIC: 'Gây nghiện',
  PSYCHOTROPIC: 'Hướng thần',
  PRECURSOR: 'Tiền chất',
};
export const IMPORT_YES_LABEL = 'Có';
export const IMPORT_NO_LABEL = 'Không';

/** Khoá so khớp TÊN không phân biệt hoa thường, dấu tiếng Việt và khoảng trắng thừa ("  Hộp " ≡ "hop"). */
export function normalizeImportName(raw: string): string {
  return stripVietnameseDiacritics(raw.replace(/\s+/g, ' ').trim());
}

function blank(raw: string | number | null | undefined): boolean {
  return raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '');
}

function lookup<T>(raw: string | number | null | undefined, table: Record<string, T>): ImportParseResult<T> {
  if (blank(raw)) return { ok: true, value: null };
  const found = table[normalizeImportName(String(raw))];
  return found === undefined ? { ok: false } : { ok: true, value: found };
}

const ITEM_TYPE_TABLE: Record<string, ImportItemType> = {
  thuoc: 'MEDICINE',
  medicine: 'MEDICINE',
  'vat tu': 'SUPPLY',
  'vat tu y te': 'SUPPLY',
  supply: 'SUPPLY',
};

const CONTROL_TYPE_TABLE: Record<string, ImportControlType> = {
  thuong: 'NORMAL',
  normal: 'NORMAL',
  doc: 'TOXIC',
  toxic: 'TOXIC',
  'gay nghien': 'NARCOTIC',
  narcotic: 'NARCOTIC',
  'huong than': 'PSYCHOTROPIC',
  psychotropic: 'PSYCHOTROPIC',
  'tien chat': 'PRECURSOR',
  precursor: 'PRECURSOR',
};

const YES_NO_TABLE: Record<string, boolean> = {
  co: true,
  x: true,
  yes: true,
  y: true,
  true: true,
  '1': true,
  khong: false,
  no: false,
  n: false,
  false: false,
  '0': false,
};

export function parseImportItemType(raw: string | number | null | undefined): ImportParseResult<ImportItemType> {
  return lookup(raw, ITEM_TYPE_TABLE);
}

export function parseImportControlType(raw: string | number | null | undefined): ImportParseResult<ImportControlType> {
  return lookup(raw, CONTROL_TYPE_TABLE);
}

export function parseImportYesNo(raw: string | number | boolean | null | undefined): ImportParseResult<boolean> {
  if (typeof raw === 'boolean') return { ok: true, value: raw };
  return lookup(raw, YES_NO_TABLE);
}

const THOUSAND_GROUPED = /^\d{1,3}([.,]\d{3})+$/;

/**
 * Số nguyên không âm (đồng, tồn tối thiểu/tối đa, hệ số quy đổi). Ô kiểu SỐ phải là số nguyên; ô kiểu
 * CHUỖI nhận "1500" hoặc có dấu ngăn nghìn "1.500"/"1,500". Số lẻ ("1500.5") và số âm → không hợp lệ.
 */
export function parseImportInteger(raw: string | number | null | undefined): ImportParseResult<number> {
  if (blank(raw)) return { ok: true, value: null };
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw >= 0 ? { ok: true, value: raw } : { ok: false };
  }
  const text = raw!.replace(/\s/g, '');
  if (/^\d+$/.test(text)) return { ok: true, value: Number(text) };
  if (THOUSAND_GROUPED.test(text)) return { ok: true, value: Number(text.replace(/[.,]/g, '')) };
  return { ok: false };
}

/**
 * Hàm lượng hoạt chất — người dùng gõ giá trị THẬT ("500", "0,5", "62.5"), kết quả là số nguyên ×1000
 * (đúng tiền lệ `vital_sign`/`DrugIngredientInput.strengthValue`, cấm decimal). Tối đa 3 chữ số thập
 * phân; dấu phẩy HOẶC chấm làm dấu thập phân (không hỗ trợ dấu ngăn nghìn — hàm lượng ít khi lớn).
 */
export function parseImportStrength(raw: string | number | null | undefined): ImportParseResult<number> {
  if (blank(raw)) return { ok: true, value: null };
  if (typeof raw === 'number') {
    const scaled = Math.round(raw * 1000);
    return raw >= 0 && Math.abs(scaled / 1000 - raw) < 1e-9 ? { ok: true, value: scaled } : { ok: false };
  }
  const text = raw!.replace(/\s/g, '');
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(text);
  if (!match) return { ok: false };
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(3, '0') || '0');
  return { ok: true, value: whole * 1000 + fraction };
}
