/**
 * Tiền tố mã tự sinh NGẮN, TUẦN TỰ cho "Nhóm dị nguyên"/"Dị nguyên" (docs/DECISIONS.md #113,
 * 2026-09-03) — thay hoàn toàn cơ chế ngẫu nhiên cũ (`generateAllergenGroupCode`/
 * `generateAllergenCode`, đã xoá). Cả hai bảng đều tự sinh mã 100% (chưa từng nhận từ client, xem
 * docs/DECISIONS.md #069) nên không cần đường lùi cho mã nhập tay.
 */
export const ALLERGEN_GROUP_CODE_PREFIX = 'ND';
export const ALLERGEN_CODE_PREFIX = 'DN';
