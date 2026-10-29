import { useContext } from 'react';
import type { ClinicPrintHeader, PrintPaperSize, ResolvedPrintTemplate } from '@nexamed/shared';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { buildPageRule, usePrintPageStyle } from '../../shared/print/print-page-style';
import { PrintPreviewContext } from '../../shared/print/print-preview.context';
import { useResolvedPrintTemplate } from '../../shared/print/print-template.queries';

/** Chữ in lên MỘT nhãn dán bì thuốc (đã ghép sẵn ở `medicine-label.ts`, đã nhân theo số bản). */
export interface MedicineLabelSheetItem {
  key: string;
  patientName: string;
  birthYear: number | null;
  /** Tên thuốc kèm hoạt chất/hàm lượng. */
  title: string;
  /** "05 Gói" — số lượng THỰC PHÁT kèm đơn vị. */
  quantityText: string;
  instruction: string | null;
  /** "Lô A123 · HSD 06/2028" — chỉ in khi bản mẫu bật "Lô và hạn dùng". */
  lotText: string | null;
}

/** Bản sao `buildDefaultPrintTemplateConfig('LABEL_70X40')` ở `packages/shared` — chỉ dùng trong khoảnh khắc trước khi `GET print-templates/resolved` nạp xong (web không import được giá trị từ shared, #073). */
const FALLBACK_TEMPLATE: ResolvedPrintTemplate = {
  documentType: 'MEDICINE_LABEL',
  paperSize: 'LABEL_70X40',
  widthMm: 70,
  heightMm: 40,
  options: [],
  config: {
    margins: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
    header: { showLogo: false, showClinicName: false, showBranchName: false, showAddress: false, showPhone: false, showTaxCode: false, showDivider: false },
    title: { text: '' },
    footer: { note: '', showSignature: false, showSignatureHint: false },
    medicineLabel: { showClinic: false, showDate: false, showLot: false },
    copies: { count: 1, labels: [] },
  },
};

const EMPTY_HEADER: ClinicPrintHeader = { name: '', branchName: null, address: null, phone: null, taxCode: null, printLogoUrl: null };

/** Cỡ chữ (pt) theo khổ tem: thanh họ tên / tên thuốc / câu dặn / dòng phụ. Khổ nhỏ chữ nhỏ hơn; câu dặn rất dài thu thêm 1 bậc. */
const METRICS: Record<'LABEL_70X40' | 'LABEL_60X40' | 'LABEL_50X30', { bar: number; title: number; body: number; small: number }> = {
  LABEL_70X40: { bar: 9, title: 10, body: 9, small: 6.5 },
  LABEL_60X40: { bar: 8.5, title: 9.5, body: 8.5, small: 6.5 },
  LABEL_50X30: { bar: 7, title: 8, body: 7, small: 5.5 },
};
const LONG_INSTRUCTION_CHARS = 140;

function metricsOf(paper: PrintPaperSize): (typeof METRICS)['LABEL_70X40'] {
  return paper === 'LABEL_60X40' ? METRICS.LABEL_60X40 : paper === 'LABEL_50X30' ? METRICS.LABEL_50X30 : METRICS.LABEL_70X40;
}

function formatDateVn(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Nhãn dán bì thuốc (docs/DECISIONS.md #267; mockup đã chốt 28/10/2026): mỗi nhãn một trang giấy đúng kích thước tem. Luôn in: thanh đen họ tên – năm sinh, tên thuốc + số lượng, câu dặn nghiêng;
 * tuỳ chọn theo bản mẫu "Nhãn thuốc" ở Quản lý mẫu in: tên phòng khám + SĐT (đầu nhãn), ngày phát và lô/hạn dùng (cuối nhãn). Khổ + lề lấy từ bản mẫu.
 * Mặc định ẨN, chỉ hiện khi in (`display="screen"` hoặc trong xem trước ở Quản lý mẫu in). In qua hộp thoại in của trình duyệt (máy in tem cài driver Windows là in được).
 */
export function MedicineLabelSheet({ labels, printedAt, display = 'print' }: { labels: MedicineLabelSheetItem[]; printedAt?: string; display?: 'print' | 'screen' }) {
  const preview = useContext(PrintPreviewContext);
  const resolved = useResolvedPrintTemplate('MEDICINE_LABEL');
  const headerQuery = useClinicPrintHeaderQuery();
  const template = preview?.template ?? resolved ?? FALLBACK_TEMPLATE;
  const clinic = preview?.clinicHeader ?? headerQuery.data ?? EMPTY_HEADER;
  const { config } = template;
  const options = config.medicineLabel ?? FALLBACK_TEMPLATE.config.medicineLabel!;
  const metrics = metricsOf(template.paperSize);
  const visibleOnScreen = preview !== null || display === 'screen';
  const heightMm = template.heightMm ?? 40;
  const when = printedAt ?? new Date().toISOString();
  const clinicLine = [clinic.name, clinic.phone].filter((p): p is string => !!p && p.trim() !== '').join(' · ');

  // Lề của nhãn do chính nhãn đảm nhiệm (padding) — `@page` để lề 0 để nhãn vừa khít 1 trang, không bị cộng lề đôi rồi tràn sang trang 2.
  usePrintPageStyle(buildPageRule(template.widthMm, heightMm, { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 }));

  return (
    <div className={`print-area ${visibleOnScreen ? '' : 'hidden print:block'}`}>
      {labels.map((label) => {
        const footerParts = [options.showDate ? `Ngày phát ${formatDateVn(when)}` : null, options.showLot ? label.lotText : null].filter((p): p is string => !!p);
        const bodySize = label.instruction && label.instruction.length > LONG_INSTRUCTION_CHARS ? metrics.body - 1 : metrics.body;
        return (
          <section
            key={label.key}
            className={`print-sheet ${visibleOnScreen ? 'mb-3 border border-dashed border-slate-400 bg-white' : ''}`}
            style={{
              width: `${template.widthMm}mm`,
              height: `${heightMm}mm`,
              padding: `${config.margins.topMm + 0.5}mm ${config.margins.rightMm + 0.5}mm ${config.margins.bottomMm + 0.5}mm ${config.margins.leftMm + 0.5}mm`,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              color: '#000',
              fontFamily: 'Arial, "Segoe UI", sans-serif',
              lineHeight: 1.2,
            }}
          >
            {options.showClinic && clinicLine && (
              <div className="truncate" style={{ fontSize: `${metrics.small}pt`, marginBottom: '0.6mm' }}>
                {clinicLine}
              </div>
            )}
            <div
              className="truncate font-semibold"
              style={{ fontSize: `${metrics.bar}pt`, background: '#000', color: '#fff', padding: '0.3mm 1.2mm', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}
            >
              {label.patientName}
              {label.birthYear !== null ? ` - ${label.birthYear}` : ''}
            </div>
            <div className="font-semibold" style={{ fontSize: `${metrics.title}pt`, borderBottom: '0.2mm solid #000', padding: '0.8mm 0', marginBottom: '0.8mm' }}>
              {label.title} <span className="whitespace-nowrap">{label.quantityText}</span>
            </div>
            {label.instruction && <p style={{ margin: 0, fontSize: `${bodySize}pt`, fontStyle: 'italic' }}>{label.instruction}</p>}
            {footerParts.length > 0 && (
              <div style={{ marginTop: 'auto', paddingTop: '0.6mm', fontSize: `${metrics.small}pt`, borderTop: '0.15mm dashed #555' }}>{footerParts.join(' · ')}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}
