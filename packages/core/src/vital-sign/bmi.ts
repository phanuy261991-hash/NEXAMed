/**
 * BMI (chỉ số khối cơ thể) — hàm thuần tái dùng ở màn hình Tiếp nhận (hiển thị nhanh lúc nhập sinh
 * hiệu) và sau này màn hình Khám bệnh (Sprint 3, S3-06). Công thức chuẩn: cân nặng(kg) /
 * chiều cao(m)². `weightGram`/`heightMm` theo đúng đơn vị lưu DB (`vital_sign.weight_gram`/
 * `height_mm`) — quy đổi ở đây, không quy đổi lặp lại ở từng nơi gọi.
 */
export function computeBmi(weightGram: number | undefined | null, heightMm: number | undefined | null): number | null {
  if (!weightGram || !heightMm || weightGram <= 0 || heightMm <= 0) return null;
  const weightKg = weightGram / 1000;
  const heightM = heightMm / 1000;
  return weightKg / (heightM * heightM);
}