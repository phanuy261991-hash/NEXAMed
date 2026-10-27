/**
 * Chuỗi ĐẦU VÀO băm tra trùng (`hashForLookup`) của từng loại dữ liệu — nguồn duy nhất để dịch vụ ghi và lệnh xoay khoá mã hoá (#262) băm GIỐNG NHAU: lệch một ký tự là mọi mã băm cũ không còn khớp.
 */

/** Mã băm tra trùng/tìm theo số thẻ BHYT — thêm tiền tố để một số trùng chữ với CCCD KHÔNG cho cùng mã băm. */
export function insuranceCardHashInput(cardNo: string): string {
  return `insurance-card:${cardNo}`;
}
