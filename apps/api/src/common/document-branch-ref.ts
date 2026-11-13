/**
 * Số chứng từ + chi nhánh sở hữu của một chứng từ — dùng cho các màn CHUNG cả công ty nhưng có dòng trỏ về chứng từ thuộc chi nhánh khác
 * (sổ công nợ NCC, Đợt 2 chi nhánh, docs/DECISIONS.md #233 Q4): hiện đủ dòng + số tiền, nhưng web khoá nút mở phiếu gốc khi chi nhánh
 * của phiếu khác chi nhánh người xem đang làm việc.
 */
export interface DocumentBranchRef {
  id: string;
  documentNo: string;
  branchId: string;
  branchName: string;
  /** Đơn đặt hàng NCC mà phiếu nhập này nhận theo (#298 giai đoạn 2) và đợt nhận thứ mấy của đơn; `null` với phiếu lập tay hoặc chứng từ khác. */
  purchaseOrderNo?: string | null;
  purchaseOrderRound?: number | null;
}
