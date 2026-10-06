import { useState } from 'react';
import { Printer } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintPaperInfo, PrintTemplateConfig } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { useClinicPrintHeaderQuery } from '../../shared/print/clinic-print-header.queries';
import { PrintPreviewProvider } from '../../shared/print/print-preview.context';
import { PrintDocumentPreview } from './PrintDocumentPreview';
import { DEFAULT_PREVIEW_ZOOM } from './print-template-labels';
import { SAMPLE_CLINIC_HEADER } from './print-samples';

const ZOOM_STEPS = [30, 40, 50, 60, 75, 90, 100, 120];

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

  // Mỗi khổ giấy có mức thu/phóng mặc định riêng; đổi khổ thì đặt lại (so khớp theo `paper.paperSize` ngay lúc render).
  const [zoomState, setZoomState] = useState({ paperSize: paper.paperSize, zoom: DEFAULT_PREVIEW_ZOOM[paper.paperSize] });
  const zoom = zoomState.paperSize === paper.paperSize ? zoomState.zoom : DEFAULT_PREVIEW_ZOOM[paper.paperSize];
  const setZoom = (value: number) => setZoomState({ paperSize: paper.paperSize, zoom: value });

  const stepIndex = ZOOM_STEPS.reduce((best, step, i) => (Math.abs(step - zoom) < Math.abs((ZOOM_STEPS[best] ?? 0) - zoom) ? i : best), 0);
  const zoomOut = () => setZoom(ZOOM_STEPS[Math.max(0, stepIndex - 1)] ?? zoom);
  const zoomIn = () => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, stepIndex + 1)] ?? zoom);

  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Xem trước bản in">
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-slate-700">Xem trước</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Dữ liệu mẫu</span>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="scroll-hover min-h-0 flex-1 overflow-auto bg-slate-100 p-4">
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
