import { useState } from 'react';
import { FileText } from '@phosphor-icons/react';
import type { CreatePrintTemplateRequest, PrintDocumentTypeInfo, PrintPaperInfo, PrintPaperSize, PrintTemplate } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { PAPER_SHORT_LABEL } from './print-template-labels';

/**
 * "Thêm bản mẫu" (docs/DECISIONS.md #211, mockup duyệt): thêm một bản mẫu cho chứng từ đang chọn ở MỘT khổ giấy khác —
 * mỗi chứng từ chỉ 1 bản/khổ nên khổ đã có bị khoá. "Bắt đầu từ" cho chọn bố cục mặc định hoặc sao chép cấu hình bản
 * đang xem. Form bọc `<form>` để Enter lưu (ui-guidelines mục 4.4).
 */
export function AddPrintTemplateDialog({
  documentType,
  papers,
  existing,
  baseTemplate,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  documentType: PrintDocumentTypeInfo;
  papers: PrintPaperInfo[];
  existing: PrintTemplate[];
  /** Bản đang xem — nguồn cho lựa chọn "Sao chép từ ...". */
  baseTemplate: PrintTemplate | null;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (dto: CreatePrintTemplateRequest) => void;
}) {
  const takenPapers = new Set(existing.map((t) => t.paperSize));
  const choices = papers.filter((p) => documentType.allowedPapers.includes(p.paperSize));
  const firstFree = choices.find((p) => !takenPapers.has(p.paperSize))?.paperSize ?? null;

  const [paperSize, setPaperSize] = useState<PrintPaperSize | null>(firstFree);
  const [name, setName] = useState(firstFree ? `${documentType.label} ${PAPER_SHORT_LABEL[firstFree]}` : '');
  const [nameTouched, setNameTouched] = useState(false);
  const [base, setBase] = useState<'DEFAULT' | 'COPY'>('DEFAULT');
  const [makeDefault, setMakeDefault] = useState(false);

  function pickPaper(size: PrintPaperSize) {
    setPaperSize(size);
    if (!nameTouched) setName(`${documentType.label} ${PAPER_SHORT_LABEL[size]}`);
  }

  const isInvalid = paperSize === null || name.trim() === '';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid || paperSize === null) return;
    onSubmit({
      documentType: documentType.documentType,
      name: name.trim(),
      paperSize,
      ...(base === 'COPY' && baseTemplate ? { config: baseTemplate.config } : {}),
      isDefault: makeDefault,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-label="Thêm bản mẫu">
      <form onSubmit={handleSubmit} className="flex max-h-[90vh] w-full max-w-[660px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-5">
          <ModalHeader icon={FileText} title="Thêm bản mẫu" subtitle={`Chứng từ: ${documentType.label}`} onClose={onCancel} />
        </div>

        <div className="scroll-hover min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-4">
          {error && <ErrorBanner message={error} />}

          <div>
            <label htmlFor="apt-name" className="mb-1.5 block text-sm font-semibold text-slate-800">
              Tên bản mẫu <span className="text-rose-500">*</span>
            </label>
            <input
              id="apt-name"
              autoFocus
              value={name}
              maxLength={100}
              onChange={(e) => {
                setName(e.target.value);
                setNameTouched(true);
              }}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div role="radiogroup" aria-label="Khổ giấy">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">
              Khổ giấy <span className="text-rose-500">*</span>
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {choices.map((p) => {
                const taken = takenPapers.has(p.paperSize);
                const selected = paperSize === p.paperSize;
                return (
                  <button
                    key={p.paperSize}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={taken}
                    onClick={() => pickPaper(p.paperSize)}
                    className={`rounded-lg border px-3.5 py-2.5 text-left ${
                      taken
                        ? 'cursor-not-allowed border-dashed border-slate-300 bg-slate-50 text-slate-400'
                        : selected
                          ? 'border-brand-teal bg-brand-teal text-white'
                          : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
                    }`}
                  >
                    <span className="block text-sm font-bold">{p.label}</span>
                    <span className={`block font-mono text-xs ${selected ? 'opacity-90' : 'text-slate-500'}`}>{taken ? 'Đã có bản mẫu' : p.description}</span>
                  </button>
                );
              })}
            </div>
            {firstFree === null && <p className="mt-2 text-sm font-medium text-amber-700">Chứng từ này đã có bản mẫu cho mọi khổ giấy được hỗ trợ.</p>}
          </div>

          <div role="radiogroup" aria-label="Bắt đầu từ">
            <span className="mb-1.5 block text-sm font-semibold text-slate-800">Bắt đầu từ</span>
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2.5 rounded-lg border border-slate-300 px-3 py-2.5">
                <input type="radio" name="apt-base" checked={base === 'DEFAULT'} onChange={() => setBase('DEFAULT')} className="mt-0.5 h-4 w-4 accent-blue-600" />
                <span>
                  <span className="block text-sm font-semibold text-slate-800">Bố cục mặc định của hệ thống</span>
                  <span className="block text-xs text-slate-500">Dùng ngay, không cần chỉnh gì thêm</span>
                </span>
              </label>
              {baseTemplate && (
                <label className="flex items-start gap-2.5 rounded-lg border border-slate-300 px-3 py-2.5">
                  <input type="radio" name="apt-base" checked={base === 'COPY'} onChange={() => setBase('COPY')} className="mt-0.5 h-4 w-4 accent-blue-600" />
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Sao chép từ &quot;{baseTemplate.name}&quot;</span>
                    <span className="block text-xs text-slate-500">Giữ nguyên lề, đầu trang, ghi chú đã cấu hình</span>
                  </span>
                </label>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} className="h-4 w-4 accent-blue-600" />
            Đặt làm bản mặc định khi bấm In
          </label>
        </div>

        <div className="flex flex-shrink-0 justify-end gap-2.5 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit" loading={submitting} disabled={isInvalid}>
            Tạo bản mẫu
          </Button>
        </div>
      </form>
    </div>
  );
}
