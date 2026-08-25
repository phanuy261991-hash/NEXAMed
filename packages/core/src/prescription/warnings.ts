import { stripVietnameseDiacritics } from '../search/strip-vietnamese-diacritics';

/**
 * Kê đơn (Sprint 4, S4-01/02) — cảnh báo MỀM, không bao giờ chặn ký (đã hỏi và chốt với chủ dự án:
 * v1 không có nguồn dữ liệu cho "chặn ký cứng" — chống chỉ định/liều theo tuổi để dành PRE-06, P2).
 * Hai hàm thuần dưới đây tính PRE-02 (trùng hoạt chất) và PRE-03 (đối chiếu dị ứng) — dùng chung ở
 * cả `apps/web` (hiển thị realtime lúc bác sĩ thêm dòng thuốc) lẫn `apps/api` (tính lại lúc lưu/ký,
 * xem `.claude/docs/coding-standards.md`: logic nghiệp vụ thuần đặt ở `packages/core`).
 */

export interface PrescriptionDrugLine {
  drugId: string;
  drugName: string;
  activeIngredient: string | null;
}

export interface DuplicateActiveIngredientWarning {
  activeIngredient: string;
  drugIds: string[];
  drugNames: string[];
}

/**
 * PRE-02 — trùng hoạt chất giữa các dòng trong đơn. So khớp `activeIngredient` đã chuẩn hoá (bỏ
 * dấu + viết thường) — dòng không có hoạt chất (`null`/rỗng) bị bỏ qua, không tính là "trùng". Trả
 * về nhóm CÓ từ 2 thuốc khác nhau trở lên cùng hoạt chất.
 */
export function findDuplicateActiveIngredients(lines: PrescriptionDrugLine[]): DuplicateActiveIngredientWarning[] {
  const groups = new Map<string, { activeIngredient: string; drugIds: string[]; drugNames: string[] }>();
  for (const line of lines) {
    const trimmed = line.activeIngredient?.trim();
    if (!trimmed) continue;
    const key = stripVietnameseDiacritics(trimmed);
    const group = groups.get(key) ?? { activeIngredient: trimmed, drugIds: [], drugNames: [] };
    if (!group.drugIds.includes(line.drugId)) {
      group.drugIds.push(line.drugId);
      group.drugNames.push(line.drugName);
    }
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.drugIds.length >= 2);
}

export interface AllergyWarning {
  allergenName: string;
  drugIds: string[];
  drugNames: string[];
}

/**
 * PRE-03 — đối chiếu dị ứng đã biết của bệnh nhân (danh mục "Dị nguyên", không phải
 * `patient.allergyNote` tự do — xem `docs/DECISIONS.md` chốt 2026-08-25) với tên thuốc/hoạt chất
 * trong đơn. So khớp CHUỖI CON hai chiều đã chuẩn hoá (không dấu, viết thường) — cố ý đơn giản
 * (không có bảng ánh xạ thuốc↔dị nguyên chuẩn ở v1, ngoài phạm vi, xem
 * `docs/product/future-modules-reference.md` mục 2.2): "Augmentin" khớp dị nguyên "Amoxicillin" chỉ
 * khi một chuỗi chứa chuỗi kia — bỏ sót là có thể xảy ra với tên thương mại khác hẳn tên hoạt chất,
 * đây là CẢNH BÁO MỀM, không phải kiểm tra dược lý đầy đủ.
 */
export function findAllergyMatches(lines: PrescriptionDrugLine[], allergenNames: string[]): AllergyWarning[] {
  const normalizedAllergens = allergenNames.map((name) => ({ raw: name, normalized: stripVietnameseDiacritics(name) })).filter((a) => a.normalized.length > 0);
  if (normalizedAllergens.length === 0) return [];

  const warnings: AllergyWarning[] = [];
  for (const allergen of normalizedAllergens) {
    const matchedLines = lines.filter((line) => {
      const candidates = [line.drugName, line.activeIngredient ?? ''].map(stripVietnameseDiacritics).filter((c) => c.length > 0);
      return candidates.some((c) => c.includes(allergen.normalized) || allergen.normalized.includes(c));
    });
    if (matchedLines.length === 0) continue;
    warnings.push({
      allergenName: allergen.raw,
      drugIds: [...new Set(matchedLines.map((l) => l.drugId))],
      drugNames: [...new Set(matchedLines.map((l) => l.drugName))],
    });
  }
  return warnings;
}
