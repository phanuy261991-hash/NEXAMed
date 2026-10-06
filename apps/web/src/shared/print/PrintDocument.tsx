import { useContext, type CSSProperties, type ReactNode } from 'react';
import type { ClinicPrintHeader, PrintDocumentType, PrintPaperSize, ResolvedPrintTemplate } from '@nexamed/shared';
import { useClinicPrintHeaderQuery } from './clinic-print-header.queries';
import { usePrintPaperChoice } from './print-paper-choice';
import { PrintPreviewContext } from './print-preview.context';
import { buildPageRule, usePrintPageStyle } from './print-page-style';
import { useResolvedPrintTemplate } from './print-template.queries';

export interface PrintSignature {
  label: string;
  /** Có tên → in tên người ký dưới nhãn; không có → để trống cho người ký tay (kèm "(Ký, ghi rõ họ tên)" nếu bản mẫu bật). */
  name?: string | null;
}

export interface PrintRenderContext {
  paperSize: PrintPaperSize;
  /** `true` với giấy cuộn K80 (72mm) — nội dung xếp 1 cột, không bảng nhiều cột. */
  compact: boolean;
}

/**
 * Hệ số thu/phóng nội dung theo khổ giấy (CSS `zoom`) — các thân chứng từ viết bằng cỡ chữ Tailwind cố định (px), thu
 * lại để vừa A5/K80 mà không phải viết bố cục riêng từng khổ cho thân bảng.
 */
const PAPER_ZOOM: Record<PrintPaperSize, number> = { A4: 1, A5: 0.88, A5_LANDSCAPE: 0.88, K80: 0.82 };

const EMPTY_HEADER: ClinicPrintHeader = { name: '', address: null, phone: null, taxCode: null, printLogoUrl: null };

/** Dự phòng CHỈ trong khoảnh khắc trước khi `GET print-templates/resolved` nạp xong (app luôn nạp sớm ở `AppShell`). */
function fallbackTemplate(documentType: PrintDocumentType): ResolvedPrintTemplate {
  return {
    documentType,
    paperSize: 'A4',
    widthMm: 210,
    heightMm: 297,
    options: [],
    config: {
      margins: { topMm: 12, rightMm: 12, bottomMm: 12, leftMm: 12 },
      header: { showLogo: true, showClinicName: true, showAddress: true, showPhone: true, showTaxCode: false, showDivider: true },
      title: { text: '' },
      footer: { note: '', showSignature: true, showSignatureHint: true },
      copies: { count: 1, labels: [] },
    },
  };
}

/**
 * Khung in DÙNG CHUNG cho mọi chứng từ ("Quản lý mẫu in", docs/DECISIONS.md #211): đầu trang, tiêu đề, cuối trang,
 * chữ ký, số liên, khổ giấy/lề (`@page`) đều lấy từ BẢN MẪU MẶC ĐỊNH của chứng từ (`documentType`) — chứng từ chỉ
 * cung cấp phần thân (`children`), tiêu đề mặc định, dòng phụ và nhãn các ô ký.
 *
 * Mặc định ẨN trên màn hình, chỉ hiện khi in (`display="print"`); `display="screen"` cho nơi cần hiện sẵn trên màn
 * hình (hộp thoại xem phiếu). Các liên thứ 2, 3 luôn chỉ hiện khi in. Nhận dữ liệu qua props, không tự gọi API
 * nghiệp vụ (chỉ đọc bản mẫu + đầu trang phòng khám đã nạp sẵn).
 */
export function PrintDocument({
  documentType,
  title,
  subtitle,
  signatures,
  signatureDateText,
  display = 'print',
  children,
}: {
  documentType: PrintDocumentType;
  /** Tiêu đề mặc định — bị `config.title.text` của bản mẫu ghi đè nếu có. */
  title: string;
  /** Dòng phụ dưới tiêu đề (số chứng từ, ngày giờ...). */
  subtitle?: ReactNode;
  signatures?: PrintSignature[];
  /** Dòng ngày tháng phía trên cụm chữ ký ("Ngày 01 tháng 10 năm 2026"). */
  signatureDateText?: string;
  display?: 'print' | 'screen';
  children: ReactNode | ((context: PrintRenderContext) => ReactNode);
}) {
  const preview = useContext(PrintPreviewContext);
  const resolved = useResolvedPrintTemplate(documentType);
  const headerQuery = useClinicPrintHeaderQuery();

  // Khổ giấy người dùng chọn CHO LẦN IN NÀY (nút "In ▾") — bỏ qua ở xem trước của Quản lý mẫu in; không chọn thì dùng bản mặc định.
  const paperChoice = usePrintPaperChoice((s) => s.choice[documentType]);
  const chosen = paperChoice ? resolved?.options.find((o) => o.paperSize === paperChoice) : undefined;
  const template: ResolvedPrintTemplate =
    preview?.template ??
    (resolved && chosen ? { ...resolved, paperSize: chosen.paperSize, widthMm: chosen.widthMm, heightMm: chosen.heightMm, config: chosen.config } : resolved) ??
    fallbackTemplate(documentType);
  const clinicHeader = preview?.clinicHeader ?? headerQuery.data ?? EMPTY_HEADER;
  const { config, paperSize } = template;
  const compact = paperSize === 'K80';
  const visibleOnScreen = preview !== null || display === 'screen';

  usePrintPageStyle(buildPageRule(template.widthMm, template.heightMm, config.margins));

  const copyCount = config.copies.count;
  const sheetStyle = {
    '--sheet-width': `${template.widthMm}mm`,
    '--sheet-min-height': template.heightMm ? `${template.heightMm}mm` : 'auto',
    '--sheet-pad': `${config.margins.topMm}mm ${config.margins.rightMm}mm ${config.margins.bottomMm}mm ${config.margins.leftMm}mm`,
  } as CSSProperties;

  const resolvedTitle = config.title.text.trim() || title;
  const body = typeof children === 'function' ? children({ paperSize, compact }) : children;
  const { header, footer } = config;
  const showSignatures = footer.showSignature && signatures !== undefined && signatures.length > 0;

  return (
    <div className={`print-area ${visibleOnScreen ? '' : 'hidden print:block'}`}>
      {Array.from({ length: copyCount }, (_, copyIndex) => (
        <section
          key={copyIndex}
          className={`print-sheet text-sm ${visibleOnScreen ? 'print-sheet-screen' : ''} ${copyIndex > 0 ? 'hidden print:block' : ''}`}
          style={sheetStyle}
        >
          <div style={{ zoom: PAPER_ZOOM[paperSize] }}>
            {copyCount > 1 && <p className="mb-1 text-right text-xs font-semibold uppercase text-slate-500">{config.copies.labels[copyIndex]?.trim() || `Liên ${copyIndex + 1}`}</p>}

            {/* Đầu trang */}
            <div className={compact ? 'text-center' : 'flex items-center gap-4'}>
              {header.showLogo && clinicHeader.printLogoUrl && (
                <img src={clinicHeader.printLogoUrl} alt="" className={compact ? 'mx-auto mb-1 h-12 w-12 object-contain' : 'h-16 w-16 flex-shrink-0 object-contain'} />
              )}
              <div className="min-w-0">
                {header.showClinicName && clinicHeader.name && <p className={`font-bold uppercase ${compact ? 'text-sm' : 'text-lg'}`}>{clinicHeader.name}</p>}
                {header.showAddress && clinicHeader.address && <p className={compact ? 'text-xs' : 'text-sm'}>Địa chỉ: {clinicHeader.address}</p>}
                {header.showPhone && clinicHeader.phone && <p className={compact ? 'text-xs' : 'text-sm'}>Điện thoại: {clinicHeader.phone}</p>}
                {header.showTaxCode && clinicHeader.taxCode && <p className={compact ? 'text-xs' : 'text-sm'}>Mã số thuế: {clinicHeader.taxCode}</p>}
              </div>
            </div>
            {header.showDivider && <div className={`mt-3 ${compact ? 'border-t border-dashed border-slate-500' : 'border-t-2 border-slate-800'}`} />}

            {/* Tiêu đề + dòng phụ */}
            <h1 className={`text-center font-bold uppercase tracking-wide ${compact ? 'mt-3 text-base' : paperSize === 'A4' ? 'mt-6 text-2xl' : 'mt-4 text-xl'}`}>{resolvedTitle}</h1>
            {subtitle && <div className="text-center text-sm">{subtitle}</div>}

            {/* Thân chứng từ */}
            {body}

            {/* Cuối trang */}
            {footer.note.trim() && <p className="mt-4 border-l-2 border-slate-400 pl-2 text-sm italic">{footer.note.trim()}</p>}
            {showSignatures && (
              <div className={`${compact ? 'mt-4' : 'mt-10'} break-inside-avoid`}>
                {signatureDateText && <p className="mb-1 text-right text-sm italic">{signatureDateText}</p>}
                <div
                  className={`grid text-center text-sm ${signatures.length === 1 && !compact ? 'ml-auto w-56' : ''}`}
                  style={{ gridTemplateColumns: `repeat(${compact ? 1 : signatures.length}, minmax(0, 1fr))`, gap: compact ? '1rem' : '0.5rem' }}
                >
                  {signatures.map((s) => (
                    <div key={s.label}>
                      <p className="font-semibold">{s.label}</p>
                      {s.name ? (
                        <p className={`font-semibold ${compact ? 'mt-8' : 'mt-14'}`}>{s.name}</p>
                      ) : (
                        <p className={`${compact ? 'mt-8' : 'mt-14'} text-xs text-slate-500`}>{footer.showSignatureHint ? '(Ký, ghi rõ họ tên)' : ''}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
