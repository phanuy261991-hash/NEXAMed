import { CaretDown, Folder } from '@phosphor-icons/react';
import type { PatientDocument } from '@nexamed/shared';
import { DocumentThumb } from './DocumentThumb';
import { formatBytes, formatIsoDateVi, groupByUploadDate, sourceBadge, tileMeta } from './patient-document-view';

/**
 * Xem THEO NGÀY (mockup màn 1): mỗi ngày tải lên là một thư mục, mới nhất ở trên; hai ngày đầu mở sẵn, các ngày cũ thu gọn. Thư mục "ngày" không có bản ghi — chỉ là cách nhóm lúc đọc.
 * Ảnh/PDF lấy từ nơi khác (kết quả cận lâm sàng, thẻ BHYT, ảnh đại diện) hiện chung, có nhãn nguồn ở góc ảnh.
 */
export function DocumentDayView({ items, today, onOpen }: { items: PatientDocument[]; today: string; onOpen: (doc: PatientDocument) => void }) {
  const groups = groupByUploadDate(items);
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((group, groupIndex) => (
        <details key={group.date} open={groupIndex < 2} className="group rounded-lg border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
            <CaretDown size={14} weight="bold" className="text-slate-500 transition-transform group-not-open:-rotate-90" aria-hidden="true" />
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Folder size={16} weight="bold" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-semibold text-slate-900">{formatIsoDateVi(group.date)}</span>
            {group.date === today && <span className="rounded-full bg-blue-100 px-2 py-px text-xs font-semibold text-blue-700">Hôm nay</span>}
            <span className="text-[13px] font-medium text-slate-500">
              {group.items.length} tệp · {formatBytes(group.totalBytes)}
            </span>
          </summary>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3 px-3.5 pb-3.5 pt-1">
            {group.items.map((doc) => {
              const badge = sourceBadge(doc.source);
              return (
                <button key={doc.id} type="button" onClick={() => onOpen(doc)} className="flex min-w-0 flex-col gap-1 text-left" title={doc.displayName}>
                  <span className="relative block h-28 overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    <DocumentThumb kind={doc.kind} url={doc.url} category={doc.category} />
                    {badge && <span className="absolute left-1.5 top-1.5 rounded bg-slate-900/80 px-1.5 py-px text-[11px] font-semibold text-white">{badge}</span>}
                  </span>
                  <span className="truncate text-[13.5px] font-semibold text-slate-900">{doc.displayName}</span>
                  <span className="truncate text-xs font-medium text-slate-500">{tileMeta(doc)}</span>
                </button>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
