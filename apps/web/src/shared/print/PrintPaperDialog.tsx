import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Printer } from '@phosphor-icons/react';
import type { PrintPaperOption, PrintPaperSize } from '@nexamed/shared';
import { Button } from '../ui/Button';
import { ModalHeader } from '../ui/ModalHeader';

function describePaper(option: PrintPaperOption): string {
  return option.heightMm === null ? `${option.widthMm} mm · giấy cuộn` : `${option.widthMm} × ${option.heightMm} mm`;
}

/**
 * Hộp thoại chọn khổ giấy lúc in (docs/DECISIONS.md #211) — mở khi bấm "In phiếu" ở `PrintButton` nếu chứng từ có từ 2
 * khổ giấy trở lên. Khổ mặc định đã cấu hình ở "Quản lý mẫu in" được chọn sẵn nên chỉ cần Enter là in đúng như cũ.
 * `onConfirm(null)` = in theo khổ mặc định (không đặt lựa chọn riêng cho lần in này).
 */
export function PrintPaperDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: PrintPaperOption[];
  onConfirm: (paperSize: PrintPaperSize | null) => void;
  onCancel: () => void;
}) {
  const defaultSize = options.find((o) => o.isDefault)?.paperSize ?? options[0]!.paperSize;
  const [selected, setSelected] = useState<PrintPaperSize>(defaultSize);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onConfirm(selected === defaultSize ? null : selected);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Chọn khổ giấy để in"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader icon={Printer} title="In phiếu" subtitle="Chọn khổ giấy" onClose={onCancel} />
        <div role="radiogroup" aria-label="Khổ giấy" className="grid gap-2 sm:grid-cols-2">
          {options.map((o) => {
            const checked = selected === o.paperSize;
            return (
              <label
                key={o.paperSize}
                className={`relative flex cursor-pointer flex-col rounded-lg border px-3.5 py-2.5 focus-within:ring-2 focus-within:ring-blue-500/30 ${
                  checked ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'
                }`}
              >
                <input
                  type="radio"
                  name="print-paper"
                  value={o.paperSize}
                  checked={checked}
                  onChange={() => setSelected(o.paperSize)}
                  autoFocus={checked}
                  className="sr-only"
                />
                <span className="flex items-center justify-between gap-2 text-sm font-bold">
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.isDefault && (
                    <span className={`inline-flex flex-shrink-0 items-center gap-1 text-xs font-semibold ${checked ? 'text-white' : 'text-brand-teal-active'}`}>
                      <Check size={12} weight="bold" aria-hidden="true" />
                      Mặc định
                    </span>
                  )}
                </span>
                <span className={`font-mono text-xs ${checked ? 'opacity-90' : 'text-slate-500'}`}>{describePaper(o)}</span>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-slate-500">Chỉ áp dụng cho lần in này. Đổi khổ mặc định ở Quản trị → Mẫu in.</p>
        <div className="mt-5 flex justify-end gap-2.5">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Huỷ
          </Button>
          <Button type="submit">
            <Printer size={15} weight="bold" aria-hidden="true" />
            In
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
