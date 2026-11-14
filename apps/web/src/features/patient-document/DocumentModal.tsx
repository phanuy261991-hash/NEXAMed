import { useEffect, type ReactNode } from 'react';

/** Vỏ hộp thoại của tab Hình ảnh & Tài liệu: nền mờ + khung trắng + Esc để đóng. Nội dung (ModalHeader, ô nhập, nút) do nơi gọi dựng. */
export function DocumentModal({ width, label, onClose, children }: { width: number; label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="max-h-full w-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl" style={{ maxWidth: width }}>
        {children}
      </div>
    </div>
  );
}

export function DocumentField({ id, label, required, children, hint, full }: { id: string; label: string; required?: boolean; children: ReactNode; hint?: string; full?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${full ? 'sm:col-span-2' : ''}`}>
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </label>
      {children}
      {hint && <span className="text-xs font-medium text-slate-500">{hint}</span>}
    </div>
  );
}

export const INPUT_CLASS =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-[15px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
