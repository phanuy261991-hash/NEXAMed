import { useEffect, useRef, useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintPaperInfo, PrintTemplateConfig } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { PrintPreviewProvider } from '../../shared/print/print-preview.context';
import { PrintDocumentPreview } from './PrintDocumentPreview';
import { DEFAULT_PREVIEW_ZOOM } from './print-template-labels';
import { PREVIEW_ZOOM_STEPS, fitPreviewZoom } from './print-preview-zoom';
import { SAMPLE_CLINIC_HEADER } from './print-samples';

/** Lề ngang của khung cuộn (`p-4` ×2) — trừ ra khi tính bề ngang còn lại cho tờ giấy. */
const SCROLL_AREA_PADDING_PX = 32;

/**
 * Vùng xem trước (bên phải) của "Quản lý mẫu in" (docs/DECISIONS.md #211): bản in THẬT của chứng từ với dữ liệu mẫu và
 * cấu hình NHÁP đang soạn, vẽ đúng tỷ lệ khổ giấy. Đầu trang dùng thông tin phòng khám thật nếu đã nhập, chưa thì dùng
 * mẫu. "In thử" gọi thẳng hộp thoại in của trình duyệt — chính bản xem trước là vùng được in (`.print-area`).
 */
export function PrintTemplatePreviewPanel({
  documentType,
  paper,
  config,
}: {
  documentType: PrintDocumentType;
  paper: PrintPaperInfo;
  config: PrintTemplateConfig;
}) {
  const headerQuery = useClinicPrintHeaderQuery();
  const clinicHeader = headerQuery.data && headerQuery.data.name ? headerQuery.data : SAMPLE_CLINIC_HEADER;

  // TỰ VỪA khổ giấy theo bề ngang khung (màn 1280px khung chỉ ~340px — mức mặc định 60% làm tờ A4 tràn mép phải): đo khung bằng ResizeObserver,
  // chọn bậc lớn nhất còn vừa nhưng không vượt mức mặc định của khổ giấy. Người dùng bấm −/+ thì chuyển sang chế độ TAY cho tới khi đổi khổ giấy.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setAvailableWidth(el.clientWidth - SCROLL_AREA_PADDING_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const autoZoom = fitPreviewZoom(availableWidth, paper.widthMm, DEFAULT_PREVIEW_ZOOM[paper.paperSize]);
  // `manualZoom` gắn với khổ giấy đã chọn nó; đổi khổ thì quay lại tự vừa (so khớp ngay lúc render).
  const [manual, setManual] = useState<{ paperSize: string; zoom: number } | null>(null);
  const zoom = manual && manual.paperSize === paper.paperSize ? manual.zoom : autoZoom;
  const setZoom = (value: number) => setManual({ paperSize: paper.paperSize, zoom: value });

  const stepIndex = PREVIEW_ZOOM_STEPS.reduce((best, step, i) => (Math.abs(step - zoom) < Math.abs((PREVIEW_ZOOM_STEPS[best] ?? 0) - zoom) ? i : best), 0);
  const zoomOut = () => setZoom(PREVIEW_ZOOM_STEPS[Math.max(0, stepIndex - 1)] ?? zoom);
  const zoomIn = () => setZoom(PREVIEW_ZOOM_STEPS[Math.min(PREVIEW_ZOOM_STEPS.length - 1, stepIndex + 1)] ?? zoom);

  return (
    <section className="flex min-w-[320px] flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Xem trước bản in">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <h2 className="text-sm font-semibold text-slate-700">Xem trước</h2>
          <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 min-[1440px]:inline">Dữ liệu mẫu</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <div className="flex h-8 items-center overflow-hidden rounded-md border border-slate-300">
            <button type="button" onClick={zoomOut} aria-label="Thu nhỏ" className="px-2.5 text-base text-slate-600 hover:bg-slate-100">
              −
            </button>
            <span className="border-x border-slate-200 px-2 font-mono text-xs leading-8 text-slate-700">{zoom}%</span>
            <button type="button" onClick={zoomIn} aria-label="Phóng to" className="px-2.5 text-base text-slate-600 hover:bg-slate-100">
              +
            </button>
          </div>
          <Button type="button" variant="secondary" onClick={() => window.print()} className="h-8 px-3 text-xs">
            <Printer size={14} weight="bold" aria-hidden="true" />
            In thử
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="scroll-hover min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
        <div className="print-no-transform mx-auto w-fit" style={{ zoom: zoom / 100 }}>
          <PrintPreviewProvider
            value={{
              template: { documentType, paperSize: paper.paperSize, widthMm: paper.widthMm, heightMm: paper.heightMm, config, options: [] },
              clinicHeader,
            }}
          >
            <PrintDocumentPreview documentType={documentType} />
          </PrintPreviewProvider>
        </div>
      </div>
    </section>
  );
}
