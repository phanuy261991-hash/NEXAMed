import { useContext } from 'react';
import type { PrintPaperSize, ResolvedPrintTemplate } from '@nexamed/shared';
import { formatShortDateTimeVn } from '../../shared/format/time';
import { Code128Barcode } from '../../shared/print/Code128Barcode';
import { buildPageRule, usePrintPageStyle } from '../../shared/print/print-page-style';
import { PrintPreviewContext } from '../../shared/print/print-preview.context';
import { useResolvedPrintTemplate } from '../../shared/print/print-template.queries';
import { genderShort } from './paraclinical-result-labels';

/** Dữ liệu in lên MỘT tem ống nghiệm. */
export interface SpecimenLabelData {
  sid: string;
  patientName: string;
  patientCode: string;
  patientBirthYear: number | null;
  patientAgeYears: number | null;
  patientGender: 'male' | 'female' | 'other' | null;
  /** Viết tắt nhóm xét nghiệm trong ống ("HH/SH"), `null` nếu nhóm chưa khai. */
  groupAbbreviation: string | null;
  /** "Nắp tím" — chỉ hiện khi bản mẫu bật "Loại ống / màu nắp". */
  capLabel: string | null;
}

/** Cấu hình tem dự phòng CHỈ trong khoảnh khắc trước khi `GET print-templates/resolved` nạp xong. Bản sao của `buildDefaultPrintTemplateConfig('LABEL_35X22')` ở `packages/shared` (web không import được giá trị, #073). */
const FALLBACK_TEMPLATE: ResolvedPrintTemplate = {
  documentType: 'SPECIMEN_LABEL',
  paperSize: 'LABEL_35X22',
  widthMm: 35,
  heightMm: 22,
  options: [],
  config: {
    margins: { topMm: 1, rightMm: 1, bottomMm: 1, leftMm: 1 },
    header: { showLogo: false, showClinicName: false, showAddress: false, showPhone: false, showTaxCode: false, showDivider: false },
    title: { text: '' },
    footer: { note: '', showSignature: false, showSignatureHint: false },
    label: { showPatientCode: false, showGroup: true, showCapColor: false, showDate: true },
    copies: { count: 1, labels: [] },
  },
};

/** Cỡ chữ (pt) và chiều cao mã vạch (mm) theo khổ tem — khổ lớn có chỗ cho chữ to hơn. */
const LABEL_METRICS: Record<'LABEL_35X22' | 'LABEL_50X30', { nameSize: number; infoSize: number; sidSize: number; barcodeMm: number }> = {
  LABEL_35X22: { nameSize: 6.5, infoSize: 5.5, sidSize: 6.5, barcodeMm: 8 },
  LABEL_50X30: { nameSize: 9, infoSize: 7, sidSize: 9, barcodeMm: 12 },
};

function isLabelPaper(paper: PrintPaperSize): paper is 'LABEL_35X22' | 'LABEL_50X30' {
  return paper === 'LABEL_35X22' || paper === 'LABEL_50X30';
}

/**
 * Tem dán ống nghiệm (Lấy mẫu xét nghiệm có tem mã vạch, docs/DECISIONS.md #220; mockup 13e): mỗi tem một trang giấy đúng kích thước tem. Khổ + lề + thông tin tuỳ chọn lấy từ bản mẫu
 * "Tem mẫu xét nghiệm" ở Quản lý mẫu in. Luôn in: mã vạch Code 128, SID, HỌ TÊN IN HOA, năm sinh, giới tính; tuỳ chọn: mã BN, nhóm xét nghiệm, loại ống/màu nắp, ngày giờ.
 * Mặc định ẨN, chỉ hiện khi in (`display="screen"` cho xem trước ở Quản lý mẫu in). In qua hộp thoại in của trình duyệt — máy in tem cài driver Windows là in được, không cần agent in.
 */
export function SpecimenLabelSheet({ labels, printedAt, display = 'print' }: { labels: SpecimenLabelData[]; printedAt?: string; display?: 'print' | 'screen' }) {
  const preview = useContext(PrintPreviewContext);
  const resolved = useResolvedPrintTemplate('SPECIMEN_LABEL');
  const template = preview?.template ?? resolved ?? FALLBACK_TEMPLATE;
  const { config } = template;
  const paper = isLabelPaper(template.paperSize) ? template.paperSize : 'LABEL_35X22';
  const metrics = LABEL_METRICS[paper];
  const options = config.label ?? FALLBACK_TEMPLATE.config.label!;
  const visibleOnScreen = preview !== null || display === 'screen';
  const heightMm = template.heightMm ?? 22;
  const when = printedAt ?? new Date().toISOString();

  // Lề của tem do chính tem đảm nhiệm (padding) — `@page` để lề 0 để tem vừa khít 1 trang, không bị cộng lề đôi rồi tràn sang trang 2.
  usePrintPageStyle(buildPageRule(template.widthMm, heightMm, { topMm: 0, rightMm: 0, bottomMm: 0, leftMm: 0 }));

  return (
    <div className={`print-area ${visibleOnScreen ? '' : 'hidden print:block'}`}>
      {labels.map((label) => {
        const infoParts = [genderShort(label.patientGender), label.patientBirthYear !== null ? String(label.patientBirthYear) : null].filter((p): p is string => p !== null && p !== '—');
        const ageText = paper === 'LABEL_35X22' && label.patientAgeYears !== null ? ` (${label.patientAgeYears}t)` : '';
        const dateText = paper === 'LABEL_50X30' ? formatShortDateTimeVn(when) : formatShortDateTimeVn(when).slice(0, 5);
        const middleRight = [options.showGroup ? label.groupAbbreviation : null, options.showCapColor ? label.capLabel : null].filter((p): p is string => !!p).join(' · ');
        return (
          <section
            key={label.sid}
            className={`print-sheet ${visibleOnScreen ? 'mb-3 border border-dashed border-slate-400' : ''}`}
            style={{
              width: `${template.widthMm}mm`,
              height: `${heightMm}mm`,
              padding: `${config.margins.topMm}mm ${config.margins.rightMm}mm ${config.margins.bottomMm}mm ${config.margins.leftMm}mm`,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              color: '#000',
              lineHeight: 1.15,
            }}
          >
            <div className="flex items-baseline justify-between gap-1" style={{ fontSize: `${metrics.nameSize}pt` }}>
              <span className="min-w-0 flex-1 truncate font-bold">{label.patientName.toLocaleUpperCase('vi-VN')}</span>
              {paper === 'LABEL_50X30' && (
                <span className="flex-none font-semibold" style={{ fontSize: `${metrics.infoSize + 1}pt` }}>
                  {infoParts.join(' · ')}
                </span>
              )}
            </div>
            {paper === 'LABEL_50X30' ? (
              <div className="flex items-baseline justify-between gap-1 font-semibold" style={{ fontSize: `${metrics.infoSize}pt` }}>
                <span className="truncate">{options.showPatientCode ? `Mã BN: ${label.patientCode}` : ''}</span>
                <span className="flex-none">{middleRight}</span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between gap-1 font-semibold" style={{ fontSize: `${metrics.infoSize}pt` }}>
                <span>
                  {infoParts.join(' · ')}
                  {ageText}
                  {options.showPatientCode ? ` · ${label.patientCode}` : ''}
                </span>
                {options.showDate && <span className="flex-none">{dateText}</span>}
              </div>
            )}
            <Code128Barcode value={label.sid} className="w-full flex-none" style={{ height: `${metrics.barcodeMm}mm` }} title={`Mã ống ${label.sid}`} />
            <div className="flex items-baseline justify-between gap-1 font-bold" style={{ fontSize: `${metrics.sidSize}pt` }}>
              <span className="tabular-nums tracking-wider">{label.sid}</span>
              {paper === 'LABEL_50X30' ? (
                options.showDate && <span className="flex-none font-semibold" style={{ fontSize: `${metrics.infoSize + 1}pt` }}>{dateText}</span>
              ) : (
                middleRight && <span className="flex-none font-semibold" style={{ fontSize: `${metrics.infoSize + 1}pt` }}>{middleRight}</span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
