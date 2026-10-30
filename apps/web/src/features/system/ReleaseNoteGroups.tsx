import type { ReleaseNotes } from '@nexamed/shared';

const NOTE_GROUPS: { key: 'features' | 'improvements' | 'fixes'; title: string }[] = [
  { key: 'features', title: 'Tính năng mới' },
  { key: 'improvements', title: 'Cải tiến' },
  { key: 'fixes', title: 'Sửa lỗi' },
];

/** Số dòng ghi chú của một bản (cả ba nhóm). */
export function countReleaseNoteLines(notes: Pick<ReleaseNotes, 'features' | 'improvements' | 'fixes'>): number {
  return notes.features.length + notes.improvements.length + notes.fixes.length;
}

/**
 * Ghi chú phát hành của MỘT bản, nhóm theo "Tính năng mới / Cải tiến / Sửa lỗi" (nhóm trống bỏ qua). Dùng chung cho khối "Có phiên bản mới" (máy chủ phát hành), "Có gì mới trong bản đang chạy"
 * và "Các bản trước" ở trang Cập nhật phần mềm.
 */
export function ReleaseNoteGroups({ notes }: { notes: Pick<ReleaseNotes, 'features' | 'improvements' | 'fixes'> }) {
  const groups = NOTE_GROUPS.filter((g) => notes[g.key].length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.key}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">{g.title}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm font-medium text-slate-800">
            {notes[g.key].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
