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
  'INVOICE',
  'INVOICE_COMBINED',
  'WALLET_TOPUP_RECEIPT',
  'CASHIER_SHIFT_RECEIPT',
  'CASH_VOUCHER',
  'STOCK_RECEIPT',
  'STOCK_ISSUE',
  'STOCK_COUNT',
  'STOCK_TRANSFER',
]);
export type PrintDocumentType = z.infer<typeof printDocumentTypeSchema>;

export const printPaperSizeSchema = z.enum(['A4', 'A5', 'A5_LANDSCAPE', 'K80']);
export type PrintPaperSize = z.infer<typeof printPaperSizeSchema>;

/** `heightMm = null` — giấy cuộn (K80), chiều dài theo nội dung. */
export const PRINT_PAPER_SPECS: Record<PrintPaperSize, { label: string; widthMm: number; heightMm: number | null; description: string }> = {
  A4: { label: 'A4 — đứng', widthMm: 210, heightMm: 297, description: '210 × 297 mm' },
  A5: { label: 'A5 — đứng', widthMm: 148, heightMm: 210, description: '148 × 210 mm' },
  A5_LANDSCAPE: { label: 'A5 — ngang', widthMm: 210, heightMm: 148, description: '210 × 148 mm' },
  K80: { label: 'K80 — máy in nhiệt', widthMm: 80, heightMm: null, description: '80 mm, giấy cuộn' },
};

export const PRINT_DOCUMENT_GROUPS = ['Khám bệnh', 'Thu ngân', 'Sổ quỹ', 'Kho'] as const;
export type PrintDocumentGroup = (typeof PRINT_DOCUMENT_GROUPS)[number];

const PAPERS_A: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE'];
const PAPERS_MONEY: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE', 'K80'];

/**
 * K80 chỉ mở cho 4 chứng từ TIỀN (chốt 01/10/2026): đơn thuốc cần ô ký bác
 * sĩ, phiếu kho nhiều cột — ép xuống 72mm không đọc được.
 */
export const PRINT_DOCUMENT_TYPE_REGISTRY: Record<
  PrintDocumentType,
  { label: string; group: PrintDocumentGroup; allowedPapers: PrintPaperSize[]; defaultPaper: PrintPaperSize; defaultTitle: string }
> = {
  PRESCRIPTION: { label: 'Đơn thuốc', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Đơn thuốc' },
  MEDICAL_RECORD: { label: 'Bệnh án (xuất PDF)', group: 'Khám bệnh', allowedPapers: ['A4'], defaultPaper: 'A4', defaultTitle: 'Bệnh án' },
  CLINICAL_ORDER: { label: 'Phiếu chỉ định cận lâm sàng', group: 'Khám bệnh', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu chỉ định cận lâm sàng' },
  INVOICE: { label: 'Phiếu thu', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: 'Phiếu thu' },
  INVOICE_COMBINED: { label: 'Phiếu thu tổng hợp', group: 'Thu ngân', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu thu tổng hợp' },
  WALLET_TOPUP_RECEIPT: { label: 'Phiếu nạp ví', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: 'Phiếu thu tạm ứng' },
  CASHIER_SHIFT_RECEIPT: { label: 'Phiếu chốt ca', group: 'Thu ngân', allowedPapers: PAPERS_MONEY, defaultPaper: 'A4', defaultTitle: 'Phiếu bàn giao ca' },
  CASH_VOUCHER: { label: 'Phiếu thu / chi tiền mặt', group: 'Sổ quỹ', allowedPapers: PAPERS_MONEY, defaultPaper: 'A5', defaultTitle: '' },
  STOCK_RECEIPT: { label: 'Phiếu nhập kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu nhập kho' },
  STOCK_ISSUE: { label: 'Phiếu xuất kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu xuất kho' },
  STOCK_COUNT: { label: 'Phiếu kiểm kê', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu kiểm kê' },
  STOCK_TRANSFER: { label: 'Phiếu điều chuyển kho', group: 'Kho', allowedPapers: PAPERS_A, defaultPaper: 'A4', defaultTitle: 'Phiếu điều chuyển kho' },
};

/** Chứng từ TIỀN — "Thiết lập nhanh" preset "A5 cho phiếu thu" áp A5 cho nhóm này, phần còn lại giữ A4. */
export const PRINT_MONEY_DOCUMENT_TYPES: PrintDocumentType[] = ['INVOICE', 'WALLET_TOPUP_RECEIPT', 'CASHIER_SHIFT_RECEIPT', 'CASH_VOUCHER'];

const marginMm = z.number().int().min(0).max(40);

export const printTemplateConfigSchema = z.object({
  margins: z.object({ topMm: marginMm, rightMm: marginMm, bottomMm: marginMm, leftMm: marginMm }),
  header: z.object({
    showLogo: z.boolean(),
    showClinicName: z.boolean(),
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
  /** Số liên in mỗi lần bấm In (1-3) + nhãn từng liên ("Liên 1 — Lưu"...). */
  copies: z.object({ count: z.number().int().min(1).max(3), labels: z.array(z.string().max(40)).max(3) }),
});
export type PrintTemplateConfig = z.infer<typeof printTemplateConfigSchema>;

export const DEFAULT_PRINT_COPY_LABELS = ['Liên 1 — Lưu', 'Liên 2 — Khách hàng', 'Liên 3'];

/** Mặc định theo khổ giấy — K80 không logo/chữ ký, lề hẹp; A4/A5 đủ đầu trang + chữ ký. */
export function buildDefaultPrintTemplateConfig(paperSize: PrintPaperSize): PrintTemplateConfig {
  const roll = paperSize === 'K80';
  const margin = roll ? 3 : paperSize === 'A4' ? 12 : 10;
  return {
    margins: { topMm: margin, rightMm: margin, bottomMm: margin, leftMm: margin },
    header: { showLogo: !roll, showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true },
    title: { text: '' },
    footer: { note: '', showSignature: !roll, showSignatureHint: true },
    copies: { count: 1, labels: [...DEFAULT_PRINT_COPY_LABELS] },
  };
}

const PAPER_ORDER: PrintPaperSize[] = ['A4', 'A5', 'A5_LANDSCAPE', 'K80'];

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
  return `${PRINT_DOCUMENT_TYPE_REGISTRY[documentType].label} ${paperSize === 'A5_LANDSCAPE' ? 'A5 ngang' : paperSize}`;
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
    config: buildDefaultPrintTemplateConfig(paperSize),
    version: null,
  };
}

/**
 * Cấu hình dùng khi in `documentType` ở khổ `paperSize` mà phòng khám CHƯA có bản mẫu cho khổ đó: mặc định theo khổ,
 * kế thừa đầu trang/tiêu đề/ghi chú/số liên từ bản mặc định (giấy cuộn K80 luôn không logo, không chữ ký).
 */
export function deriveConfigForPaper(paperSize: PrintPaperSize, base: PrintTemplateConfig): PrintTemplateConfig {
  const defaults = buildDefaultPrintTemplateConfig(paperSize);
  const roll = paperSize === 'K80';
  return {
    ...defaults,
    header: { ...base.header, showLogo: roll ? false : base.header.showLogo },
    title: base.title,
    footer: { ...defaults.footer, note: base.footer.note },
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
    config: size === paperSize ? config : (storedByPaper[size] ?? deriveConfigForPaper(size, config)),
  }));
  return { documentType, paperSize, widthMm: spec.widthMm, heightMm: spec.heightMm, config, options };
}

/** Danh mục tĩnh (loại chứng từ + khổ giấy + cấu hình mặc định từng khổ) trả kèm `GET /print-templates`. */
export function buildPrintTemplateCatalog(): PrintTemplateCatalog {
  const papers = printPaperSizeSchema.options;
  return {
    documentTypes: printDocumentTypeSchema.options.map((documentType) => {
      const info = PRINT_DOCUMENT_TYPE_REGISTRY[documentType];
      return { documentType, label: info.label, group: info.group, allowedPapers: sortPrintPapers(info.allowedPapers), defaultPaper: info.defaultPaper, defaultTitle: info.defaultTitle };
    }),
    papers: papers.map((paperSize) => ({ paperSize, ...PRINT_PAPER_SPECS[paperSize] })),
    defaultConfigs: Object.fromEntries(papers.map((p) => [p, buildDefaultPrintTemplateConfig(p)])) as Record<PrintPaperSize, PrintTemplateConfig>,
  };
}
