/**
 * Cổng Đơn thuốc quốc gia (donthuocquocgia.vn, QĐ 808/QĐ-BYT) — xem
 * .claude/docs/project-structure.md bảng Port/adapter. Ngoài phạm vi v1
 * (`docs/product/prd.md` Appendix A liệt kê BHYT + chữ ký số vào v3). Port khai báo sẵn để
 * `prescription` (v1, chỉ ghi nhận + in) có chỗ nối vào khi tích hợp thật ở v3 — v1 adapter
 * no-op, luôn báo chưa triển khai, không có service nào gọi.
 *
 * Điều kiện thật sự để hiện thực hoá port này (không chỉ vấn đề code):
 * 1. `SignaturePort` phải có adapter chữ ký số CA thật — cổng bắt buộc field `signature`
 *    trong mọi lần gửi đơn, chữ ký logic (`signed_at`/`signed_by`) hiện tại không đáp ứng được.
 * 2. Phòng khám (cơ sở KCB) và từng bác sĩ phải được cấp "mã liên thông" + mật khẩu từ đơn vị
 *    vận hành cổng — một thủ tục đăng ký ngoài phần mềm, không phải việc code.
 */
export interface EPrescriptionSubmission {
  encounterId: string;
  prescriptionId: string;
}

export interface EPrescriptionSubmissionResult {
  nationalPrescriptionCode: string;
}

export interface EPrescriptionGatewayPort {
  sendPrescription(submission: EPrescriptionSubmission): Promise<EPrescriptionSubmissionResult>;
}

export const E_PRESCRIPTION_GATEWAY_PORT = Symbol('E_PRESCRIPTION_GATEWAY_PORT');
