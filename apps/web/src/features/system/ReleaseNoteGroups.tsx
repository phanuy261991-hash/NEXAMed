import { useId, useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { ReleaseNotes } from '@nexamed/shared';

type NoteKey = 'features' | 'improvements' | 'fixes';

const NOTE_GROUPS: { key: NoteKey; title: string; countClass: string }[] = [
  { key: 'features', title: 'Tính năng mới', countClass: 'text-blue-700' },
  { key: 'improvements', title: 'Cải tiến', countClass: 'text-teal-700' },
  { key: 'fixes', title: 'Sửa lỗi', countClass: 'text-amber-700' },
];

/** Số dòng ghi chú của một bản (cả ba nhóm). */
export function countReleaseNoteLines(notes: Pick<ReleaseNotes, 'features' | 'improvements' | 'fixes'>): number {
  return notes.features.length + notes.improvements.length + notes.fixes.length;
}

/**
 * Ghi chú phát hành của MỘT bản, nhóm theo "Tính năng mới / Cải tiến / Sửa lỗi" (nhóm trống bỏ qua). Mỗi nhóm MẶC ĐỊNH THU GỌN — hiện tên nhóm, số mục và nút "Xem chi tiết"; bấm mới xổ nội dung
 * ra (chủ dự án chốt mockup 06/11/2026). Dùng chung cho khối "Có phiên bản mới" (máy chủ phát hành) và "Có gì mới trong bản đang chạy" ở trang Cập nhật phần mềm. Đặt TRONG khung `SectionCard`
 * (các dòng chạy sát mép khung, ngăn cách bằng đường kẻ mảnh).
 */
export function ReleaseNoteGroups({ notes }: { notes: Pick<ReleaseNotes, 'features' | 'improvements' | 'fixes'> }) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<NoteKey>>(new Set());
  const groups = NOTE_GROUPS.filter((g) => notes[g.key].length > 0);
  if (groups.length === 0) return null;

  const toggle = (key: NoteKey) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="divide-y divide-slate-100">
      {groups.map((g) => {
        const isOpen = open.has(g.key);
        const panelId = `${baseId}-${g.key}`;
        return (
          <div key={g.key}>
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggle(g.key)}
              className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50"
            >
              <CaretRight size={16} weight="bold" aria-hidden="true" className={`flex-shrink-0 text-slate-600 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
              <span className="text-[15px] font-semibold text-slate-900">{g.title}</span>
              <span className="text-[13.5px] text-slate-600">
                <span className={`text-[15px] font-semibold ${g.countClass}`}>{notes[g.key].length}</span> mục
              </span>
              <span className="ml-auto text-[13.5px] font-semibold text-blue-700">{isOpen ? 'Thu gọn' : 'Xem chi tiết'}</span>
            </button>
            {isOpen && (
              <ul id={panelId} className="list-disc space-y-1.5 pb-4 pl-[52px] pr-5 text-sm font-normal leading-relaxed text-slate-800">
                {notes[g.key].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
