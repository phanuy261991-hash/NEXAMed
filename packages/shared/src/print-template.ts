import { z } from 'zod';

/**
 * "Quản lý mẫu in" (docs/DECISIONS.md #211, mockup chủ dự án duyệt 01/10/2026). Mỗi LOẠI CHỨNG TỪ có
 * nhiều BẢN MẪU theo khổ giấy (A4/A5/A5 ngang/K80), 1 bản là mặc định (dùng khi bấm In). Mỗi bản chỉ
 * cấu hình trong khuôn có sẵn (khổ giấy + lề, đầu trang, tiêu đề, cuối trang/chữ ký, số liên) — KHÔNG phải
 * trình soạn thảo tự do. Chưa lưu gì thì dùng mặc định dựng sẵn ở đây (`buildDefaultPrintTemplateConfig`),
 * nên phòng khám mới cài in được ngay, không phải thiết lập.
 *
 * Đặt ở `packages/shared` (không phải `core`): `apps/web` bị ESLint chặn import `@nexamed/core` (#073) mà
 * CẦN danh mục chứng từ, kích thước giấy và hàm dựng mặc định để vẽ khung in/xem trước.
 */
export const printDocumentTypeSchema = z.enum([
  'PRESCRIPTION',
  'MEDICAL_RECORD',
  'CLINICAL_ORDER',
  'LAB_RESULT',
  'IMAGING_RESULT',
  'INVOICE',
  'INVOICE_COMBINED',
  'WALLET_TOPUP_RECEIPT',
  'CASHIER_SHIFT_RECEIPT',
  'CASH_VOUCHER',
  'STOCK_RECEIPT',
  'STOCK_ISSUE',
  'STOCK_COUNT',
  'STOCK_TRANSFER',
  'SPECIMEN_LABEL',
  // Nhãn dán bì thuốc in từ màn Phát thuốc (docs/DECISIONS.md #267) — khổ tem LABEL_70X40 / LABEL_60X40 / LABEL_50X30.
  'MEDICINE_LABEL',
]);
export type PrintDocumentType = z.infer<typeof printDocumentTypeSchema>;

export const printPaperSizeSchema = z.enum(['A4', 'A5', 'A5_LANDSCAPE', 'K80', 'LABEL_35X22', 'LABEL_50X30', 'LABEL_70X40', 'LABEL_60X40']);
export type PrintPaperSize = z.infer<typeof printPaperSizeSchema>;

/** `heightMm = null` — giấy cuộn (K80), chiều dài theo nội dung. */
export const PRINT_PAPER_SPECS: Record<PrintPaperSize, { label: string; widthMm: number; heightMm: number | null; description: string }> = {
  A4: { label: 'A4 — đứng', widthMm: 210, heightMm: 297, description: '210 × 297 mm' },
  A5: { label: 'A5 — đứng', widthMm: 148, heightMm: 210, description: '148 × 210 mm' },
  A5_LANDSCAPE: { label: 'A5 — ngang', widthMm: 210, heightMm: 148, description: '210 × 148 mm' },
  K80: { label: 'K80 — máy in nhiệt', widthMm: 80, heightMm: null, description: '80 mm, giấy cuộn' },
  // Tem ống nghiệm (docs/DECISIONS.md #220) — chỉ chứng từ SPECIMEN_LABEL.
  LABEL_35X22: { label: '35 × 22 mm', widthMm: 35, heightMm: 22, description: 'Tem ống nghiệm nhỏ' },
  LABEL_50X30: { label: '50 × 30 mm', widthMm: 50, heightMm: 30, description: 'Tem lớn, đủ chỗ thêm thông tin' },
  // Nhãn dán bì thuốc (docs/DECISIONS.md #267) — chỉ chứng từ MEDICINE_LABEL (50 × 30 dùng chung với tem ống nghiệm).
  LABEL_70X40: { label: '70 × 40 mm', widthMm: 70, heightMm: 40, description: 'Tem nhãn thuốc, mặc định' },
  LABEL_60X40: { label: '60 × 40 mm', widthMm: 60, heightMm: 40, description: 'Tem nhãn thuốc, nhỏ hơn' },
};

export const PRINT_DOCUMENT_GROUPS = ['Khám bệnh', 'Thu ngân', 'Sổ quỹ', 'Kho'] as const;
export type PrintDocumentGroup = (typeof PRINT_DOCUMENT_GROUPS)[number];

const PAPERS_A: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE'];
const PAPERS_MONEY: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE', 'K80'];
const PAPERS_LABEL: PrintPaperSize[] = ['LABEL_35X22', 'LABEL_50X30'];
const PAPERS_MEDICINE_LABEL: PrintPaperSize[] = ['LABEL_70X40', 'LABEL_60X40', 'LABEL_50X30'];

/** Khổ tem (không phải khổ giấy văn bản): không có đầu trang/tiêu đề/chữ ký. Tem ống nghiệm có bộ tuỳ chọn riêng `config.label`, nhãn thuốc có `config.medicineLabel`. */
export function isLabelPaper(paperSize: PrintPaperSize): boolean {
  return paperSize === 'LABEL_35X22' || paperSize === 'LABEL_50X30' || paperSize === 'LABEL_70X40' || paperSize === 'LABEL_60X40';
}

/**
 * K80 chỉ mở cho 4 chứng từ TIỀN (chốt 01/10/2026): đơn thuốc cần ô ký bác
 * sĩ, phiếu kho nhiều cột — ép xuống 72mm không đọc được.
 */
/**
 * Khối "Khuyến cáo / lưu ý" in ngay sau thân chứng từ — chỉ chứng từ khai `notice` mới có (hiện: Kết quả xét nghiệm). Bật/tắt và sửa nội dung ở "Quản lý mẫu in";
 * chưa sửa thì dùng nội dung mặc định này. Mỗi dòng của `text` là một dòng in (người dùng tự gõ "- " nếu muốn gạch đầu dòng).
 */
export interface PrintNoticeDefaults {
  title: string;
  defaultText: string;
}

const LAB_RESULT_NOTICE: PrintNoticeDefaults = {
  title: 'Khuyến cáo khách hàng',
  defaultText: [
    '- Kết quả phụ thuộc vào mẫu xét nghiệm được thu thập và chất lượng của mẫu.',
    '- Xét nghiệm là công cụ giúp chẩn đoán, cần tương quan với lâm sàng bởi bác sĩ chỉ định.',
    '- Mẫu lặp lại được chấp nhận theo yêu cầu của bác sĩ chỉ định trong vòng 24 giờ sau khi trả kết quả.',
    '- Kết quả có thể khác nhau giữa các phòng xét nghiệm khác nhau.',
  ].join('\n'),
};

export const PRINT_DOCUMENT_TYPE_REGISTRY: Record<
  PrintDocumentType,
  { label: string; group: PrintDocumentGroup; allowedPapers: PrintPaperSize[]; defaultPaper: PrintPaperSize; defaultTitle: string; notice?: PrintNoticeDefaults }
> = {
  PRESCRIPTION: { label: 'Đơn thuốc', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Đơn thuốc' },
  MEDICAL_RECORD: { label: 'Bệnh án', group: 'Khám bệnh', allowedPapers: ['A4'], defaultPaper: 'A4', defaultTitle: 'Bệnh án' },
  CLINICAL_ORDER: { label: 'Phiếu chỉ định cận lâm sàng', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu chỉ định cận lâm sàng' },
  LAB_RESULT: { label: 'Kết quả xét nghiệm', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Kết quả xét nghiệm', notice: LAB_RESULT_NOTICE },
  IMAGING_RESULT: { label: 'Kết quả CĐHA & Thăm dò chức năng', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Kết quả chẩn đoán hình ảnh' },
  INVOICE: { label: 'Phiếu thu', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: 'Phiếu thu' },
  INVOICE_COMBINED: { label: 'Phiếu thu tổng hợp', group: 'Thu ngân', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu thu tổng hợp' },
  WALLET_TOPUP_RECEIPT: { label: 'Phiếu nạp ví', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: 'Phiếu thu tạm ứng' },
  CASHIER_SHIFT_RECEIPT: { label: 'Phiếu chốt ca', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A4', defaultTitle: 'Phiếu bàn giao ca' },
  CASH_VOUCHER: { label: 'Phiếu thu / chi tiền mặt', group: 'Sổ quỹ', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: '' },
  STOCK_RECEIPT: { label: 'Phiếu nhập kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu nhập kho' },
  STOCK_ISSUE: { label: 'Phiếu xuất kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu xuất kho' },
  STOCK_COUNT: { label: 'Phiếu kiểm kê', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu kiểm kê' },
  STOCK_TRANSFER: { label: 'Phiếu điều chuyển kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu điều chuyển kho' },
  SPECIMEN_LABEL: { label: 'Tem mẫu xét nghiệm', group: 'Khám bệnh', allowedPapers: PAPERS_LABEL, defaultPaper: 'LABEL_35X22', defaultTitle: '' },
  MEDICINE_LABEL: { label: 'Nhãn thuốc', group: 'Kho', allowedPapers: PAPERS_MEDICINE_LABEL, defaultPaper: 'LABEL_70X40', defaultTitle: '' },
};

/** Chứng từ TIỀN — "Thiết lập nhanh" preset "A5 cho phiếu thu" áp A5 cho nhóm này, phần còn lại giữ A4. */
export const PRINT_MONEY_DOCUMENT_TYPES: PrintDocumentType[] = ['INVOICE', 'WALLET_TOPUP_RECEIPT', 'CASHIER_SHIFT_RECEIPT', 'CASH_VOUCHER'];

const marginMm = z.number().int().min(0).max(40);

/** Công tắc thông tin in trên đơn thuốc (mockup đã duyệt 20/10/2026, docs/DECISIONS.md #242). */
export const prescriptionInfoConfigSchema = z.object({
  showPatientCode: z.boolean(),
  showNationalId: z.boolean(),
  /** Bệnh nhân chưa có CCCD (vd. trẻ em): `hide` = ẩn cả dòng, `dots` = in dòng chấm để viết tay. */
  nationalIdWhenMissing: z.enum(['hide', 'dots']),
  showAddress: z.boolean(),
  showPhone: z.boolean(),
  showWeight: z.boolean(),
  /** Người giám hộ — chỉ in cho trẻ dưới 72 tháng tuổi. */
  showGuardian: z.boolean(),
  /** Đợt "từ ngày … đến hết ngày …" — chỉ đơn "N". */
  showCourse: z.boolean(),
  /** Số lượng viết bằng chữ — chỉ đơn "N" (Thông tư 52/2017, điều 6). */
  showQuantityInWords: z.boolean(),
  /** Ô người nhận thuốc (ký, họ tên, số CCCD) — đơn "N" và "H". */
  showReceiverBox: z.boolean(),
  /** Số lượng dưới 10 in hai chữ số ("05 Gói", "01 Hộp") như toa mẫu — mặc định BẬT (docs/DECISIONS.md #267); bản mẫu lưu trước đó chưa có trường này = bật. */
  padSmallQuantity: z.boolean().default(true),
});
export type PrescriptionInfoConfig = z.infer<typeof prescriptionInfoConfigSchema>;

export const DEFAULT_PRESCRIPTION_INFO_CONFIG: PrescriptionInfoConfig = {
  showPatientCode: true,
  showNationalId: true,
  nationalIdWhenMissing: 'hide',
  showAddress: true,
  showPhone: true,
  showWeight: true,
  showGuardian: true,
  showCourse: true,
  showQuantityInWords: true,
  showReceiverBox: true,
  padSmallQuantity: true,
};

/**
 * Dòng "Số thẻ BHYT" trên chứng từ in (S2-04, docs/DECISIONS.md #243, mockup đã chốt 21/10/2026): MỖI loại chứng từ (đơn thuốc, phiếu thu, bệnh án PDF) có ô tích riêng, mặc định TẮT.
 * Dữ liệu lấy từ thẻ đã chụp vào lượt khám (số thẻ hiện rõ). `whenSelfPay`: lượt khám tự chi trả thì ẩn cả dòng (`hide`) hoặc in "Tự chi trả" (`selfPay`).
 * Chỉ có tác dụng khi công tắc "Áp dụng BHYT" của phòng khám đang BẬT.
 */
export const insurancePrintConfigSchema = z.object({ show: z.boolean(), whenSelfPay: z.enum(['hide', 'selfPay']) });
export type InsurancePrintConfig = z.infer<typeof insurancePrintConfigSchema>;
export const DEFAULT_INSURANCE_PRINT_CONFIG: InsurancePrintConfig = { show: false, whenSelfPay: 'hide' };
/** Chứng từ có dòng "Số thẻ BHYT" (S2-04). */
export const INSURANCE_PRINT_DOCUMENT_TYPES: PrintDocumentType[] = ['PRESCRIPTION', 'INVOICE', 'MEDICAL_RECORD'];

/**
 * Trường TUỲ CHỌN trên nhãn dán bì thuốc (docs/DECISIONS.md #267, mockup đã chốt 28/10/2026). Họ tên – năm sinh, tên thuốc (hàm lượng) + số lượng, câu dặn LUÔN in nên không có công tắc.
 * Mặc định cả ba TẮT: nhãn giữ đúng 3 khối như nhãn phòng khám đang dùng.
 */
export const medicineLabelConfigSchema = z.object({ showClinic: z.boolean(), showDate: z.boolean(), showLot: z.boolean() });
export type MedicineLabelConfig = z.infer<typeof medicineLabelConfigSchema>;
export const DEFAULT_MEDICINE_LABEL_CONFIG: MedicineLabelConfig = { showClinic: false, showDate: false, showLot: false };

export const printTemplateConfigSchema = z.object({
  margins: z.object({ topMm: marginMm, rightMm: marginMm, bottomMm: marginMm, leftMm: marginMm }),
  header: z.object({
    showLogo: z.boolean(),
    showClinicName: z.boolean(),
    /** Đợt 2 chi nhánh (#233): in dòng tên chi nhánh dưới tên phòng khám — chỉ có tác dụng khi công ty có từ 2 chi nhánh. Mẫu cũ chưa có trường này = bật. */
    showBranchName: z.boolean().default(true),
    showAddress: z.boolean(),
    showPhone: z.boolean(),
    showTaxCode: z.boolean(),
    showDivider: z.boolean(),
  }),
  /** Tiêu đề chứng từ — để trống = dùng tiêu đề mặc định của loại chứng từ (phiếu thu/chi tự đổi theo hướng). */
  title: z.object({ text: z.string().max(60) }),
  footer: z.object({
    /** Dòng ghi chú tự do cuối chứng từ (ví dụ "Tái khám theo lịch hẹn"). */
    note: z.string().max(200),
    showSignature: z.boolean(),
    showSignatureHint: z.boolean(),
  }),
  /** Khối khuyến cáo/lưu ý sau thân chứng từ — chỉ chứng từ có `notice` ở registry. Vắng = dùng mặc định của registry (xem `withDefaultPrintNotice`). */
  notice: z.object({ show: z.boolean(), title: z.string().max(60), text: z.string().max(1000) }).optional(),
  /** Thông tin in THÊM trên tem ống nghiệm (chỉ chứng từ SPECIMEN_LABEL, #220). Mã vạch, SID, họ tên, năm sinh, giới tính luôn in nên không có công tắc. */
  label: z.object({ showPatientCode: z.boolean(), showGroup: z.boolean(), showCapColor: z.boolean(), showDate: z.boolean() }).optional(),
  /** Trường tuỳ chọn trên nhãn dán bì thuốc (chỉ chứng từ MEDICINE_LABEL, #267). Vắng = tắt hết (xem `withDefaultMedicineLabelOptions`). */
  medicineLabel: medicineLabelConfigSchema.optional(),
  /** Thông tin in THÊM trên đơn thuốc (chỉ chứng từ PRESCRIPTION, #242): thông tin bệnh nhân dùng chung mọi loại đơn + các mục riêng của đơn "N"/"H" (Thông tư 52/2017). Vắng = bật hết (xem `withDefaultPrescriptionInfo`). Họ tên, ngày sinh, giới tính, bác sĩ, chẩn đoán luôn in nên không có công tắc. */
  prescriptionInfo: prescriptionInfoConfigSchema.optional(),
  /** Dòng "Số thẻ BHYT" (S2-04, #243) — chỉ chứng từ ở `INSURANCE_PRINT_DOCUMENT_TYPES`. Vắng = tắt (xem `withDefaultInsuranceOptions`). */
  insurance: insurancePrintConfigSchema.optional(),
  /** Số liên in mỗi lần bấm In (1-3) + nhãn từng liên ("Liên 1 — Lưu"...). */
  copies: z.object({ count: z.number().int().min(1).max(3), labels: z.array(z.string().max(40)).max(3) }),
});
export type PrintTemplateConfig = z.infer<typeof printTemplateConfigSchema>;

/** Nội dung khuyến cáo mặc định của chứng từ (`undefined` nếu chứng từ không có khối này). */
export function defaultPrintNotice(documentType: PrintDocumentType): PrintTemplateConfig['notice'] {
  const notice = PRINT_DOCUMENT_TYPE_REGISTRY[documentType].notice;
  return notice ? { show: true, title: notice.title, text: notice.defaultText } : undefined;
}

/**
 * Điền khối khuyến cáo mặc định nếu cấu hình CHƯA có (bản mẫu lưu trước khi có tính năng, hoặc bản dựng sẵn) và bỏ khối đó ở chứng từ không hỗ trợ — để web chỉ việc
 * đọc `config.notice`, không cần biết bảng mặc định (web không import được giá trị từ `@nexamed/shared`, #032).
 */
export function withDefaultPrintNotice(documentType: PrintDocumentType, config: PrintTemplateConfig): PrintTemplateConfig {
  const fallback = defaultPrintNotice(documentType);
  if (!fallback) {
    if (config.notice === undefined) return config;
    const { notice: _dropped, ...rest } = config;
    void _dropped;
    return rest;
  }
  return { ...config, notice: config.notice ?? fallback };
}

/**
 * Điền khối `prescriptionInfo` mặc định (bật hết) cho đơn thuốc nếu CHƯA có, và bỏ khối này ở chứng từ khác — để web chỉ đọc `config.prescriptionInfo`, không cần biết bảng mặc định.
 */
export function withDefaultPrescriptionInfo(documentType: PrintDocumentType, config: PrintTemplateConfig): PrintTemplateConfig {
  if (documentType !== 'PRESCRIPTION') {
    if (config.prescriptionInfo === undefined) return config;
    const { prescriptionInfo: _dropped, ...rest } = config;
    void _dropped;
    return rest;
  }
  return { ...config, prescriptionInfo: config.prescriptionInfo ?? { ...DEFAULT_PRESCRIPTION_INFO_CONFIG } };
}

/** Điền khối `insurance` mặc định (TẮT) cho chứng từ có dòng BHYT nếu CHƯA có, và bỏ khối này ở chứng từ khác — để web chỉ đọc `config.insurance`. */
export function withDefaultInsuranceOptions(documentType: PrintDocumentType, config: PrintTemplateConfig): PrintTemplateConfig {
  if (!INSURANCE_PRINT_DOCUMENT_TYPES.includes(documentType)) {
    if (config.insurance === undefined) return config;
    const { insurance: _dropped, ...rest } = config;
    void _dropped;
    return rest;
  }
  return { ...config, insurance: config.insurance ?? { ...DEFAULT_INSURANCE_PRINT_CONFIG } };
}

/**
 * Điền khối `medicineLabel` mặc định (tắt hết) cho nhãn thuốc nếu CHƯA có, và bỏ khối này ở chứng từ khác. Khổ 50×30 dùng chung với tem ống nghiệm nên nhãn thuốc cũng bỏ khối `label`
 * (tuỳ chọn của tem ống nghiệm) mà dựng-sẵn theo khổ giấy mang theo — để web chỉ đọc đúng khối của chứng từ mình.
 */
export function withDefaultMedicineLabelOptions(documentType: PrintDocumentType, config: PrintTemplateConfig): PrintTemplateConfig {
  if (documentType !== 'MEDICINE_LABEL') {
    if (config.medicineLabel === undefined) return config;
    const { medicineLabel: _dropped, ...rest } = config;
    void _dropped;
    return rest;
  }
  const { label: _specimenOptions, ...rest } = config;
  void _specimenOptions;
  return { ...rest, medicineLabel: config.medicineLabel ?? { ...DEFAULT_MEDICINE_LABEL_CONFIG } };
}

/** Mọi phần mặc định phụ thuộc loại chứng từ (khuyến cáo, thông tin đơn thuốc, dòng BHYT, nhãn thuốc) — một chỗ gọi cho API lẫn dựng bản mẫu sẵn. */
export function withDefaultPrintOptions(documentType: PrintDocumentType, config: PrintTemplateConfig): PrintTemplateConfig {
  return withDefaultMedicineLabelOptions(documentType, withDefaultInsuranceOptions(documentType, withDefaultPrescriptionInfo(documentType, withDefaultPrintNotice(documentType, config))));
}

export const DEFAULT_PRINT_COPY_LABELS = ['Liên 1 — Lưu', 'Liên 2 — Khách hàng', 'Liên 3'];

/** Mặc định theo khổ giấy — K80 không logo/chữ ký, lề hẹp; A4/A5 đủ đầu trang + chữ ký. */
export function buildDefaultPrintTemplateConfig(paperSize: PrintPaperSize): PrintTemplateConfig {
  if (isLabelPaper(paperSize)) {
    const large = paperSize === 'LABEL_50X30';
    return {
      margins: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
      header: { showLogo: false, showClinicName: false, showBranchName: false, showAddress: false, showPhone: false, showTaxCode: false, showDivider: false },
      title: { text: '' },
      footer: { note: '', showSignature: false, showSignatureHint: false },
      label: { showPatientCode: large, showGroup: true, showCapColor: large, showDate: true },
      copies: { count: 1, labels: [...DEFAULT_PRINT_COPY_LABELS] },
    };
  }
  const roll = paperSize === 'K80';
  const margin = roll ? 3 : paperSize === 'A4' ? 12 : 10;
  return {
    margins: { topMm: margin, rightMm: margin, bottomMm: margin, leftMm: margin },
    header: { showLogo: !roll, showClinicName: true, showBranchName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true },
    title: { text: '' },
    footer: { note: '', showSignature: !roll, showSignatureHint: true },
    copies: { count: 1, labels: [...DEFAULT_PRINT_COPY_LABELS] },
  };
}

const PAPER_ORDER: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE', 'K80', 'LABEL_35X22', 'LABEL_50X30', 'LABEL_70X40', 'LABEL_60X40'];

/** Sắp khổ giấy theo thứ tự cố định để mọi nơi (chip, danh sách) hiện giống nhau. */
export function sortPrintPapers(papers: PrintPaperSize[]): PrintPaperSize[] {
  return [...papers].sort((a, b) => PAPER_ORDER.indexOf(a) - PAPER_ORDER.indexOf(b));
}

/** Một bản mẫu. `id = null` + `isBuiltin = true`: bản mặc định dựng sẵn, chưa lưu DB (lưu lần đầu mới sinh dòng). */
export const printTemplateSchema = z.object({
  id: z.string().uuid().nullable(),
  documentType: printDocumentTypeSchema,
  name: z.string(),
  paperSize: printPaperSizeSchema,
  isDefault: z.boolean(),
  isBuiltin: z.boolean(),
  config: printTemplateConfigSchema,
  version: z.number().int().nullable(),
});
export type PrintTemplate = z.infer<typeof printTemplateSchema>;

/** Mô tả khổ giấy — dữ liệu đi qua API vì `apps/web` KHÔNG import được giá trị từ `@nexamed/shared` (lỗi Rollup khi build, #032). */
export const printPaperInfoSchema = z.object({
  paperSize: printPaperSizeSchema,
  label: z.string(),
  description: z.string(),
  widthMm: z.number().int(),
  heightMm: z.number().int().nullable(),
});
export type PrintPaperInfo = z.infer<typeof printPaperInfoSchema>;

export const printDocumentTypeInfoSchema = z.object({
  documentType: printDocumentTypeSchema,
  label: z.string(),
  group: z.string(),
  allowedPapers: z.array(printPaperSizeSchema),
  defaultPaper: printPaperSizeSchema,
  defaultTitle: z.string(),
  /** Khối khuyến cáo mặc định của chứng từ (`null` = chứng từ không có khối này) — cho nút "Khôi phục nội dung mặc định" ở màn Quản lý mẫu in. */
  notice: z.object({ title: z.string(), defaultText: z.string() }).nullable(),
});
export type PrintDocumentTypeInfo = z.infer<typeof printDocumentTypeInfoSchema>;

/** Danh mục tĩnh kèm danh sách bản mẫu: loại chứng từ, khổ giấy và cấu hình MẶC ĐỊNH từng khổ (cho "Khôi phục mặc định"/sao chép). */
export const printTemplateCatalogSchema = z.object({
  documentTypes: z.array(printDocumentTypeInfoSchema),
  papers: z.array(printPaperInfoSchema),
  defaultConfigs: z.record(printPaperSizeSchema, printTemplateConfigSchema),
});
export type PrintTemplateCatalog = z.infer<typeof printTemplateCatalogSchema>;

export const listPrintTemplatesResponseSchema = z.object({ items: z.array(printTemplateSchema), catalog: printTemplateCatalogSchema });
export type ListPrintTemplatesResponse = z.infer<typeof listPrintTemplatesResponseSchema>;

/**
 * Một LỰA CHỌN khổ giấy khi in một chứng từ: bản mẫu đã lưu của khổ đó, hoặc (chưa có bản mẫu cho khổ) cấu hình dựng sẵn của
 * khổ kế thừa đầu trang/tiêu đề/ghi chú từ bản mặc định — để người dùng in thử khổ khác mà không phải tạo bản mẫu trước.
 */
export const printPaperOptionSchema = z.object({
  paperSize: printPaperSizeSchema,
  label: z.string(),
  widthMm: z.number().int(),
  heightMm: z.number().int().nullable(),
  isDefault: z.boolean(),
  config: printTemplateConfigSchema,
});
export type PrintPaperOption = z.infer<typeof printPaperOptionSchema>;

/**
 * Bản MẶC ĐỊNH đang áp dụng của từng chứng từ — nạp 1 lần lúc vào app để in tức thì (xem `usePrintTemplate`). Kèm kích
 * thước giấy để vẽ khung in, và `options` = mọi khổ giấy chứng từ này in được (cho nút chọn khổ lúc in; gồm cả bản mặc định).
 */
export const resolvedPrintTemplateSchema = z.object({
  documentType: printDocumentTypeSchema,
  paperSize: printPaperSizeSchema,
  widthMm: z.number().int(),
  heightMm: z.number().int().nullable(),
  config: printTemplateConfigSchema,
  options: z.array(printPaperOptionSchema),
});
export type ResolvedPrintTemplate = z.infer<typeof resolvedPrintTemplateSchema>;

export const listResolvedPrintTemplatesResponseSchema = z.object({ items: z.array(resolvedPrintTemplateSchema) });
export type ListResolvedPrintTemplatesResponse = z.infer<typeof listResolvedPrintTemplatesResponseSchema>;

export const createPrintTemplateRequestSchema = z.object({
  documentType: printDocumentTypeSchema,
  name: z.string().trim().min(1).max(100),
  paperSize: printPaperSizeSchema,
  /** Bỏ trống = mặc định dựng sẵn theo khổ giấy. Có `config` thì dùng (sao chép từ bản khác ở web). */
  config: printTemplateConfigSchema.optional(),
  isDefault: z.boolean().optional(),
});
export type CreatePrintTemplateRequest = z.infer<typeof createPrintTemplateRequestSchema>;

export const updatePrintTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: printTemplateConfigSchema.optional(),
  /** Chỉ `true` có nghĩa (đặt làm mặc định, tự bỏ cờ ở bản cũ); muốn đổi mặc định thì đặt bản KHÁC làm mặc định. */
  isDefault: z.literal(true).optional(),
  version: z.number().int().positive(),
});
export type UpdatePrintTemplateRequest = z.infer<typeof updatePrintTemplateRequestSchema>;

export const deletePrintTemplateRequestSchema = z.object({ version: z.number().int().positive() });
export type DeletePrintTemplateRequest = z.infer<typeof deletePrintTemplateRequestSchema>;

/**
 * "Thiết lập nhanh" — khai MỘT lần, áp cho nhiều chứng từ. `paperPreset`: `ALL_A4` mọi chứng từ A4;
 * `MONEY_A5_REST_A4` phiếu thu/phiếu nạp/chốt ca/thu-chi dùng A5, phần còn lại A4; `KEEP` giữ khổ đang dùng
 * (bỏ qua bước chọn khổ). `header` ghi đè khối "Đầu trang" của bản mẫu mặc định mỗi chứng từ được chọn.
 */
export const printQuickSetupPresetSchema = z.enum(['ALL_A4', 'MONEY_A5_REST_A4', 'KEEP']);
export type PrintQuickSetupPreset = z.infer<typeof printQuickSetupPresetSchema>;

export const printQuickSetupRequestSchema = z.object({
  paperPreset: printQuickSetupPresetSchema,
  header: printTemplateConfigSchema.shape.header,
  documentTypes: z.array(printDocumentTypeSchema).min(1),
});
export type PrintQuickSetupRequest = z.infer<typeof printQuickSetupRequestSchema>;

export const printQuickSetupResponseSchema = z.object({ appliedCount: z.number().int() });
export type PrintQuickSetupResponse = z.infer<typeof printQuickSetupResponseSchema>;

/** Khổ giấy mà `preset` áp cho `documentType` — `null` = giữ nguyên khổ đang dùng (`KEEP`). */
export function paperForQuickSetupPreset(preset: PrintQuickSetupPreset, documentType: PrintDocumentType): PrintPaperSize | null {
  if (preset === 'KEEP') return null;
  if (preset === 'ALL_A4') return 'A4';
  return PRINT_MONEY_DOCUMENT_TYPES.includes(documentType) ? 'A5' : 'A4';
}

/** Tên bản mẫu tự đặt khi tạo qua "Thiết lập nhanh"/lần lưu đầu từ bản dựng sẵn. */
export function defaultPrintTemplateName(documentType: PrintDocumentType, paperSize: PrintPaperSize): string {
  const paperName = paperSize === 'A5_LANDSCAPE' ? 'A5 ngang' : isLabelPaper(paperSize) ? PRINT_PAPER_SPECS[paperSize].label : paperSize;
  return `${PRINT_DOCUMENT_TYPE_REGISTRY[documentType].label} ${paperName}`;
}

/** Bản dựng sẵn của 1 chứng từ (chưa lưu DB) — nguồn duy nhất cho API (`GET`) lẫn web (fallback khi chưa nạp). */
export function buildBuiltinPrintTemplate(documentType: PrintDocumentType): PrintTemplate {
  const paperSize = PRINT_DOCUMENT_TYPE_REGISTRY[documentType].defaultPaper;
  return {
    id: null,
    documentType,
    name: defaultPrintTemplateName(documentType, paperSize),
    paperSize,
    isDefault: true,
    isBuiltin: true,
    config: withDefaultPrintOptions(documentType, buildDefaultPrintTemplateConfig(paperSize)),
    version: null,
  };
}

/**
 * Cấu hình dùng khi in `documentType` ở khổ `paperSize` mà phòng khám CHƯA có bản mẫu cho khổ đó: lề và tuỳ chọn tem theo mặc định của khổ,
 * còn lại kế thừa từ bản mặc định (`base`, ở khổ `basePaperSize`): đầu trang, tiêu đề, ghi chú, ô chữ ký, khuyến cáo, công tắc thông tin đơn thuốc, số liên.
 * Giấy cuộn K80 luôn không logo, không chữ ký (ràng buộc của khổ giấy, không phải lựa chọn của phòng khám) nên khi `base` là K80 hai công tắc đó KHÔNG được mang sang khổ khác.
 * Thêm trường mới vào `printTemplateConfigSchema` thì phải kế thừa ở đây — `print-template.spec.ts` quét mọi chứng từ × mọi khổ để chặn quên.
 */
export function deriveConfigForPaper(paperSize: PrintPaperSize, base: PrintTemplateConfig, basePaperSize?: PrintPaperSize): PrintTemplateConfig {
  const defaults = buildDefaultPrintTemplateConfig(paperSize);
  const roll = paperSize === 'K80';
  const baseIsRoll = basePaperSize === 'K80';
  return {
    ...defaults,
    header: { ...base.header, showLogo: roll ? false : baseIsRoll ? defaults.header.showLogo : base.header.showLogo },
    title: base.title,
    footer: {
      note: base.footer.note,
      showSignature: roll ? false : baseIsRoll ? defaults.footer.showSignature : base.footer.showSignature,
      showSignatureHint: base.footer.showSignatureHint,
    },
    ...(base.notice ? { notice: base.notice } : {}),
    // Công tắc thông tin trên đơn thuốc (#242) cũng kế thừa — nếu không, in ra khổ giấy khác khổ mặc định sẽ quay về "bật hết" và các lựa chọn của phòng khám không áp được.
    ...(base.prescriptionInfo ? { prescriptionInfo: base.prescriptionInfo } : {}),
    // Dòng "Số thẻ BHYT" (S2-04, #243) cũng kế thừa — cùng lý do `prescriptionInfo`.
    ...(base.insurance ? { insurance: base.insurance } : {}),
    // Trường tuỳ chọn nhãn thuốc (#267) cũng kế thừa giữa các khổ tem — cùng lý do `prescriptionInfo`.
    ...(base.medicineLabel ? { medicineLabel: base.medicineLabel } : {}),
    copies: base.copies,
  };
}

/**
 * Dựng bản "resolved" từ bản mặc định + các bản mẫu đã lưu: `options` có MỌI khổ giấy được phép của chứng từ (bản đã lưu
 * dùng đúng cấu hình đã lưu; khổ chưa có bản mẫu dùng `deriveConfigForPaper`). Dùng ở API; web nhận sẵn qua `GET resolved`.
 */
export function buildResolvedPrintTemplate(
  documentType: PrintDocumentType,
  paperSize: PrintPaperSize,
  config: PrintTemplateConfig,
  storedByPaper: Partial<Record<PrintPaperSize, PrintTemplateConfig>> = {},
): ResolvedPrintTemplate {
  const spec = PRINT_PAPER_SPECS[paperSize];
  const options: PrintPaperOption[] = sortPrintPapers(PRINT_DOCUMENT_TYPE_REGISTRY[documentType].allowedPapers).map((size) => ({
    paperSize: size,
    label: PRINT_PAPER_SPECS[size].label,
    widthMm: PRINT_PAPER_SPECS[size].widthMm,
    heightMm: PRINT_PAPER_SPECS[size].heightMm,
    isDefault: size === paperSize,
    config: withDefaultPrintOptions(documentType, size === paperSize ? config : (storedByPaper[size] ?? deriveConfigForPaper(size, config, paperSize))),
  }));
  return { documentType, paperSize, widthMm: spec.widthMm, heightMm: spec.heightMm, config: withDefaultPrintOptions(documentType, config), options };
}

/** Danh mục tĩnh (loại chứng từ + khổ giấy + cấu hình mặc định từng khổ) trả kèm `GET /print-templates`. */
export function buildPrintTemplateCatalog(): PrintTemplateCatalog {
  const papers = printPaperSizeSchema.options;
  return {
    documentTypes: printDocumentTypeSchema.options.map((documentType) => {
      const info = PRINT_DOCUMENT_TYPE_REGISTRY[documentType];
      return { documentType, label: info.label, group: info.group, allowedPapers: sortPrintPapers(info.allowedPapers), defaultPaper: info.defaultPaper, defaultTitle: info.defaultTitle, notice: info.notice ?? null };
    }),
    papers: papers.map((paperSize) => ({ paperSize, ...PRINT_PAPER_SPECS[paperSize] })),
    defaultConfigs: Object.fromEntries(papers.map((p) => [p, buildDefaultPrintTemplateConfig(p)])) as Record<PrintPaperSize, PrintTemplateConfig>,
  };
}
