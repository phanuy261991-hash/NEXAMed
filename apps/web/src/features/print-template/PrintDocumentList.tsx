import { useMemo, useState } from 'react';
import { MagnifyingGlass } from '@phosphor-icons/react';
import type { PrintDocumentType, PrintDocumentTypeInfo, PrintTemplate } from '@nexamed/shared';
import { PAPER_SHORT_LABEL } from './print-template-labels';

/**
 * Vùng trái của "Quản lý mẫu in": danh sách loại chứng từ nhóm theo module, kèm khổ giấy các bản mẫu đang có (bản mặc
 * định in đậm). Ô đang chọn chỉ tô nền xanh nhạt + chữ xanh (không vạch màu bên trái — chủ dự án đã chỉnh mockup).
 */
export function PrintDocumentList({
  documentTypes,
  templates,
  selected,
  onSelect,
}: {
  documentTypes: PrintDocumentTypeInfo[];
  templates: PrintTemplate[];
  selected: PrintDocumentType;
  onSelect: (documentType: PrintDocumentType) => void;
}) {
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = documentTypes.filter((d) => q === '' || d.label.toLowerCase().includes(q));
    const order: string[] = [];
    for (const d of documentTypes) if (!order.includes(d.group)) order.push(d.group);
    return order.map((group) => ({ group, items: filtered.filter((d) => d.group === group) })).filter((g) => g.items.length > 0);
  }, [documentTypes, search]);

  return (
    <section className="flex w-[274px] flex-shrink-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Loại chứng từ">
      <div className="border-b border-slate-100 p-3">
        <div className="relative">
          <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm chứng từ..."
            aria-label="Tìm chứng từ"
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>
      <div className="scroll-hover min-h-0 flex-1 overflow-y-auto p-2">
        {groups.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">Không có chứng từ nào khớp.</p>}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="px-2 pb-1 pt-3 text-[10.5px] font-bold uppercase tracking-wider text-slate-400 first:pt-1">{group}</div>
            {items.map((d) => {
              const own = templates.filter((t) => t.documentType === d.documentType);
              const active = d.documentType === selected;
              return (
                <button
                  key={d.documentType}
                  type="button"
                  onClick={() => onSelect(d.documentType)}
                  aria-current={active ? 'true' : undefined}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm ${active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="min-w-0 truncate">{d.label}</span>
                  <span className={`flex-shrink-0 font-mono text-[11px] ${active ? 'text-blue-700' : 'text-slate-400'}`}>
                    {own.map((t) => PAPER_SHORT_LABEL[t.paperSize]).join(' · ')}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
