/**
 * Sinh PDF từ HTML (S6-06, ADM-05 — xuất bệnh án PDF) — xem .claude/docs/project-structure.md
 * bảng Port/adapter. `packages/core` không phụ thuộc trình duyệt/Chromium (thuần, không framework)
 * nên chỉ khai interface ở đây; adapter thật (`puppeteer-core` + Chromium hệ thống) đặt ở
 * `apps/api/src/infrastructure/pdf/`. Nhận vào HTML đã dựng sẵn (bởi hàm thuần
 * `renderPatientMedicalRecordHtml()`, cùng package) — port không biết gì về hình dạng dữ liệu
 * nghiệp vụ, chỉ làm đúng một việc "HTML string → PDF buffer".
 */
export interface PdfRendererPort {
  renderHtmlToPdf(html: string): Promise<Buffer>;
}

export const PDF_RENDERER_PORT = Symbol('PDF_RENDERER_PORT');
