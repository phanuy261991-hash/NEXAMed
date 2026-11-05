import { useEffect, useRef, useState } from 'react';
import { CaretDown, X } from '@phosphor-icons/react';
import { Icd10SearchPicker } from '../../../shared/ui/Icd10SearchPicker';

/**
 * Ô lọc "Chẩn đoán" (mã ICD-10) của Sổ khám bệnh (mockup đã duyệt): đóng lại là một nút hiện "Tất cả mã ICD-10" hoặc mã đã chọn; mở ra có ô tìm mã/tên bệnh trong danh mục Bộ Y tế
 * (dùng lại `Icd10SearchPicker`). Chỉ CHỌN từ danh mục — không nhập mã tự do (CLAUDE.md). Chọn một mã sẽ lọc theo tiền tố (chọn `J06` ra cả `J06.9`). Esc hoặc bấm ra ngoài thì đóng.
 */
export function Icd10FilterCombobox({ id, code, name, onChange }: { id: string; code: string; name: string; onChange: (next: { code: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selected = code !== '';
  return (
    <div ref={rootRef} className="relative w-[230px]">
      <div className="flex items-center rounded-md border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
        <button
          id={id}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm font-normal text-slate-900 focus:outline-none"
        >
          <span className="truncate" title={selected ? `${code} ${name}` : undefined}>
            {selected ? `${code} ${name}` : 'Tất cả mã ICD-10'}
          </span>
          <CaretDown size={14} aria-hidden="true" className={`flex-shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180 text-blue-600' : ''}`} />
        </button>
        {selected && (
          <button type="button" aria-label="Bỏ lọc chẩn đoán" onClick={() => onChange({ code: '', name: '' })} className="mr-1 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-[420px] rounded-md border border-slate-200 bg-white p-3 shadow-lg">
          <Icd10SearchPicker
            excludeCodes={[]}
            placeholder="Gõ mã ICD-10 hoặc tên bệnh..."
            onSelect={(item) => {
              onChange({ code: item.icd10Code, name: item.icd10Name });
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
