import { randomUUID } from 'node:crypto';

/**
 * Sinh mã ngắn ngẫu nhiên cho một mục `reference_catalog` khi client không cung cấp `code` (mở
 * rộng ADM-01, yêu cầu chủ dự án 2026-08-20 — 4 danh mục nhân sự không bắt admin tự nghĩ mã).
 * Dùng `crypto.randomUUID()` (không phải `Math.random()`/timestamp — an toàn, không đoán được),
 * tiền tố 2 ký tự đầu của `category` chỉ để gợi nhớ, KHÔNG phải khoá duy nhất (uniqueness thật
 * đến từ constraint `UNIQUE(category, code)` ở DB — 2 ký tự đầu trùng giữa các category khác
 * nhau, ví dụ `EMPLOYMENT_STATUS`/`EMPLOYMENT_TYPE` cùng "EM", không sao vì không so trùng chéo
 * category). Khác `formatDisplayCode` (patient_code/employee_code) — đây KHÔNG phải mã hiển thị
 * cho người dùng cuối xem/đối chiếu, chỉ là khoá nội bộ khi category đó chủ đích ẩn ô "Mã" trên
 * UI, nên không cần theo khuôn `<prefix><yyMM><seq6>` tuần tự theo tenant.
 */
export function generateReferenceCatalogCode(category: string): string {
  const prefix = category.slice(0, 2).toUpperCase();
  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
  return `${prefix}-${suffix}`;
}