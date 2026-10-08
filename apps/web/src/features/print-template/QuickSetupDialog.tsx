import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Sparkle } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintDocumentTypeInfo, PrintQuickSetupPreset, PrintQuickSetupRequest, PrintTemplateConfig } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';

type HeaderConfig = PrintTemplateConfig['header'];

const HEADER_TOGGLES: { key: keyof HeaderConfig; label: string }[] = [
  { key: 'showLogo', label: 'Logo phòng khám' },
  { key: 'showClinicName', label: 'Tên phòng khám' },
  { key: 'showAddress', label: 'Địa chỉ' },
  { key: 'showPhone', label: 'Điện thoại' },
  { key: 'showTaxCode', label: 'Mã số thuế' },
  { key: 'showDivider', label: 'Đường kẻ dưới' },
];

const PRESETS: { value: PrintQuickSetupPreset; title: string; hint: string }[] = [
  { value: 'ALL_A4', title: 'A4 cho mọi chứng từ', hint: 'Máy in văn phòng thông thường' },
  { value: 'MONEY_A5_REST_A4', title: 'A5 cho phiếu thu', hint: 'Phiếu thu/chi/nạp ví/chốt ca dùng A5, còn lại A4' },
  { value: 'KEEP', title: 'Giữ khổ đang dùng', hint: 'Chỉ áp phần đầu trang, không đổi khổ giấy' },
];

/**
 * "Thiết lập nhanh" (docs/DECISIONS.md #211, mockup duyệt) — khai khổ giấy + đầu trang MỘT lần, áp cho nhiều chứng từ
 * và đặt làm bản mặc định. Điểm mấu chốt cho người mới cài: không phải sửa từng chứng từ. Form bọc `<form>` (Enter = Áp dụng).
 */
export function QuickSetupDialog({
  documentTypes,
  initialHeader,
  submitting,
  error,
  onCancel,
  onSubmit,
}: {
  documentTypes: PrintDocumentTypeInfo[];
  initialHeader: HeaderConfig;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (dto: PrintQuickSetupRequest) => void;
}) {
  const [preset, setPreset] = useState<PrintQuickSetupPreset>('ALL_A4');
  const [header, setHeader] = useState<HeaderConfig>(initialHeader);
  const [selected, setSelected] = useState<Set<PrintDocumentType>>(() => new Set(documentTypes.map((d) => d.documentType)));

  const allSelected = selected.size === documentTypes.length;
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(documentTypes.map((d) => d.documentType)) : new Set());
  const toggleOne = (documentType: PrintDocumentType, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(documentType);
    else next.delete(documentType);
    setSelected(next);
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) return;
    onSubmit({ paperPreset: preset, header, documentTypes: documentTypes.map((d) => d.documentType).filter((t) => selected.has(t)) });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4" role="dialog" aria-modal="true" aria-label="Thiết lập nhanh mẫu in">
      <form onSubmit={handleSubmit} className="flex max-h-[92vh] w-full max-w-[820px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex-shrink-0 px-6 pt-5">
          <ModalHeader icon={Sparkle} title="Thiết lập nhanh mẫu in" subtitle="Khai một lần, áp cho nhiều chứng từ" onClose={onCancel} />
        </div>

        <div className="scroll-hover min-h-0 flex-1 space-y-5 overflow-y-auto px-6 pb-4">
          {error && <ErrorBanner message={error} />}

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-800">1. Phòng khám dùng khổ giấy nào?</h3>
            <div role="radiogroup" aria-label="Khổ giấy" className="grid gap-2.5 sm:grid-cols-3">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  role="radio"
                  aria-checked={preset === p.value}
                  onClick={() => setPreset(p.value)}
                  className={`rounded-lg border px-3 py-2.5 text-left ${preset === p.value ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 hover:border-blue-400 hover:bg-brand-teal-tint'}`}
                >
                  <span className="block text-sm font-bold">{p.title}</span>
                  <span className={`mt-0.5 block text-xs ${preset === p.value ? 'opacity-90' : 'text-slate-500'}`}>{p.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-800">2. Đầu trang hiện những gì?</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-slate-200 px-3.5 py-3 sm:grid-cols-3">
              {HEADER_TOGGLES.map((t) => (
                <label key={t.key} className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={header[t.key]} onChange={(e) => setHeader({ ...header, [t.key]: e.target.checked })} className="h-4 w-4 accent-blue-600" />
                  {t.label}
                </label>
              ))}
            </div>
            <p className="mt-2 flex items-start gap-2 border-l-2 border-blue-600 bg-blue-50 px-3 py-2 text-xs text-slate-700">
              <Info size={14} weight="fill" className="mt-0.5 flex-shrink-0 text-blue-700" aria-hidden="true" />
              <span>
                Nội dung lấy từ <strong>Thông tin phòng khám</strong>. Chưa có logo in?{' '}
                <Link to="/admin/system-config" className="font-semibold text-blue-700 hover:underline">
                  Tải lên tại đây
                </Link>{' '}
                — thiếu thì đầu trang tự bỏ qua, không vỡ bố cục.
              </span>
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-bold text-slate-800">3. Áp cho những chứng từ nào?</h3>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input type="checkbox" checked={allSelected} onChange={(e) => toggleAll(e.target.checked)} className="h-4 w-4 accent-blue-600" />
                  Tất cả {documentTypes.length} chứng từ
                </label>
                <span className="text-xs text-slate-500">Bỏ chọn từng mục nếu muốn giữ nguyên</span>
              </div>
              <div className="grid gap-x-4 gap-y-2 px-3.5 py-3 sm:grid-cols-3">
                {documentTypes.map((d) => (
                  <label key={d.documentType} className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={selected.has(d.documentType)} onChange={(e) => toggleOne(d.documentType, e.target.checked)} className="h-4 w-4 accent-blue-600" />
                    {d.label}
                  </label>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-6 py-3.5">
          <p className="text-xs text-slate-500">
            Sẽ ghi đè khổ giấy &amp; đầu trang của <strong className="text-slate-900">{selected.size}</strong> chứng từ đã chọn.
          </p>
          <div className="flex gap-2.5">
            <Button type="button" variant="secondary" onClick={onCancel}>
              Huỷ
            </Button>
            <Button type="submit" loading={submitting} disabled={selected.size === 0}>
              Áp dụng
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
