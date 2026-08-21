import { randomUUID } from 'node:crypto';

/**
 * Sinh mã ngắn ngẫu nhiên cho "Nhóm dị nguyên"/"Dị nguyên" khi tạo mới — client KHÔNG được nhập
 * tay mã cho danh mục này (khác `generateReferenceCatalogCode`, nơi client vẫn có thể tự cung
 * cấp `code`; docs/DECISIONS.md #069 chốt "mã phải tự phát sinh"). Cùng thuật toán
 * `generateReferenceCatalogCode` (`packages/core/src/reference-catalog/generate-code.ts`):
 * `crypto.randomUUID()` cắt ngắn, không phải `Math.random()`/timestamp. Viết hàm riêng thay vì
 * tái dùng thẳng `generateReferenceCatalogCode` vì hàm đó nhận tham số `category` (gắn với bảng
 * `reference_catalog`) — không đụng tới code đang chạy tốt cho một khác biệt nhỏ về tiền tố.
 */
export function generateAllergenGroupCode(): string {
  return `NDN-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function generateAllergenCode(): string {
  return `DN-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}
