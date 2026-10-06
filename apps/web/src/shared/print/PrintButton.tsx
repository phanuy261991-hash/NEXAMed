import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CaretDown, Check, Printer } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintPaperSize } from '@nexamed/shared';
import { Button } from '../ui/Button';
import { usePrintPaperChoice } from './print-paper-choice';
import { useResolvedPrintTemplate } from './print-template.queries';

/**
 * Nút "In" dùng chung cho mọi chứng từ (docs/DECISIONS.md #211): bấm nút chính = in theo KHỔ MẶC ĐỊNH đã cấu hình ở "Quản
 * lý mẫu in"; mũi tên bên cạnh mở danh sách khổ giấy để in lần này theo khổ khác (A4/A5/K80...). Lựa chọn chỉ áp cho lần
 * in đó (xem `print-paper-choice.ts`). `onPrint` là đúng hàm in cũ của nơi gọi (dựng chứng từ rồi `window.print()`) — nút
 * này chỉ đặt khổ giấy trước khi gọi.
 */
export function PrintButton({
  documentType,
  onPrint,
  children = 'In phiếu',
  variant = 'secondary',
  loading,
  disabled,
  className = '',
}: {
  documentType: PrintDocumentType;
  onPrint: () => void;
  children?: ReactNode;
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const resolved = useResolvedPrintTemplate(documentType);
  const setChoice = usePrintPaperChoice((s) => s.setChoice);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const options = resolved?.options ?? [];

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function print(paperSize: PrintPaperSize | null) {
    setOpen(false);
    setChoice(documentType, paperSize);
    onPrint();
  }

  return (
    <div className={`relative inline-flex items-center gap-1 ${className}`} ref={containerRef}>
      <Button type="button" variant={variant} loading={loading} disabled={disabled} onClick={() => print(null)}>
        <Printer size={15} weight="bold" aria-hidden="true" />
        {children}
      </Button>
      {options.length > 1 && (
        <Button
          type="button"
          variant={variant}
          disabled={disabled || loading}
          className="px-2"
          aria-label="Chọn khổ giấy để in"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <CaretDown size={12} weight="bold" className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </Button>
      )}
      {open && (
        <div role="menu" aria-label="Khổ giấy" className="absolute right-0 top-full z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-md">
          <p className="px-3 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">In lần này theo khổ</p>
          {options.map((o) => (
            <button
              key={o.paperSize}
              type="button"
              role="menuitem"
              onClick={() => print(o.isDefault ? null : o.paperSize)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <span className="min-w-0 truncate">{o.label}</span>
              {o.isDefault ? (
                <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-semibold text-brand-teal-active">
                  <Check size={12} weight="bold" aria-hidden="true" />
                  Mặc định
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
