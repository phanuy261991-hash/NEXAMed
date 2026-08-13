/**
 * Định dạng số tiền (đồng) để hiển thị — dùng ở "Loại khám" (giá tham khảo, chỉ hiển thị, không
 * tính toán viện phí ở v1, xem docs/DECISIONS.md). Tách ra `shared/format` vì dùng ở 2 nơi
 * (`ReferenceCatalogPane.tsx`, `ReceptionRegisterPage.tsx`) — đúng ngưỡng "trùng lặp lần hai"
 * theo CLAUDE.md.
 */
export function formatVnd(amount: number): string {
  return `${amount.toLocaleString('vi-VN')} đ`;
}
