import { useMemo, useState } from 'react';
import { BookOpenText, ListMagnifyingGlass, MagnifyingGlass } from '@phosphor-icons/react';
import type { Icd10CodeItem } from '@nexamed/shared';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue';
import { useIcd10ChaptersQuery, useIcd10CodesQuery, useIcd10GroupsQuery, useIcd10SearchQuery } from './icd10.queries';

const inputClassName =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

const GENDER_LABEL: Record<string, string> = { male: 'Chỉ nam', female: 'Chỉ nữ' };
const USAGE_LABEL: Record<string, string> = {
  limited_primary: 'Hạn chế dùng làm bệnh chính',
  not_primary: 'Không dùng làm bệnh chính',
};

/**
 * Trang tra cứu ICD-10 (S3-01, mở khoá một phần — bổ sung dần theo chương) — THUẦN ĐỌC, không CRUD (giống
 * `province`/`ward`, khác `reference_catalog`). Ô tìm nhanh bỏ qua cascade; không nhập gì thì hiện
 * 3 cột lọc tuần tự Chương → Nhóm (gộp theo Khối làm tiêu đề phụ) → Bảng mã chi tiết. Cảnh báo
 * giới tính/hạn chế bệnh chính chỉ hiển thị dạng badge tham khảo — logic chặn thật sự thuộc bộ
 * chọn chẩn đoán ở màn khám (S3-06/07, chưa xây).
 */
export function Icd10Pane() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedChapterCode, setSelectedChapterCode] = useState<string | null>(null);
  const [selectedGroupCode, setSelectedGroupCode] = useState<string | null>(null);

  const isSearching = debouncedSearch.trim() !== '';

  const chaptersQuery = useIcd10ChaptersQuery();
  const groupsQuery = useIcd10GroupsQuery(selectedChapterCode ?? '');
  const codesQuery = useIcd10CodesQuery(selectedGroupCode ?? '');
  const searchQuery = useIcd10SearchQuery(isSearching ? debouncedSearch.trim() : '');

  const chapters = chaptersQuery.data?.items ?? [];
  const groups = groupsQuery.data?.items ?? [];

  // Nhóm các dòng Nhóm liên tiếp theo Khối (dữ liệu server đã sort theo groupCode nên các nhóm
  // cùng Khối luôn đứng liền nhau — không cần gom lại bằng Map).
  const groupSections = useMemo(() => {
    const sections: { blockCode: string; blockName: string; groups: typeof groups }[] = [];
    for (const group of groups) {
      const last = sections[sections.length - 1];
      if (last && last.blockCode === group.blockCode) {
        last.groups.push(group);
      } else {
        sections.push({ blockCode: group.blockCode, blockName: group.blockName, groups: [group] });
      }
    }
    return sections;
  }, [groups]);

  function selectChapter(chapterCode: string) {
    setSelectedChapterCode(chapterCode);
    setSelectedGroupCode(null);
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative w-80">
        <MagnifyingGlass
          size={15}
          weight="regular"
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Tìm nhanh theo mã hoặc tên bệnh (bỏ qua cascade)..."
          className={`${inputClassName} pl-8`}
        />
      </div>

      {isSearching ? (
        <SearchResults query={searchQuery.data?.items} isLoading={searchQuery.isLoading} isError={searchQuery.isError} onRetry={() => searchQuery.refetch()} />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          {/* Cột 1 — Chương */}
          <div className="flex w-56 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Chương</span>
            </div>
            {chaptersQuery.isError && (
              <div className="p-2">
                <ErrorBanner message="Không tải được danh mục Chương." onRetry={() => chaptersQuery.refetch()} />
              </div>
            )}
            {chaptersQuery.isLoading && (
              <div className="space-y-2 p-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {chaptersQuery.isSuccess && (
              <ul className="flex-1 overflow-y-auto scroll-hover py-1">
                {chapters.map((chapter) => {
                  const selected = selectedChapterCode === chapter.chapterCode;
                  return (
                    <li key={chapter.chapterCode}>
                      <button
                        type="button"
                        onClick={() => selectChapter(chapter.chapterCode)}
                        className={`w-full px-3 py-2 text-left text-sm font-medium ${
                          selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="font-bold">{chapter.chapterCode}</span> — {chapter.chapterName}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Cột 2 — Nhóm (gộp theo Khối làm tiêu đề phụ) */}
          <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-3 py-2.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-500">Nhóm bệnh</span>
            </div>
            {selectedChapterCode === null && (
              <p className="px-3 py-3 text-xs text-slate-400">Chọn Chương ở cột bên trái.</p>
            )}
            {selectedChapterCode !== null && groupsQuery.isError && (
              <div className="p-2">
                <ErrorBanner message="Không tải được danh mục Nhóm." onRetry={() => groupsQuery.refetch()} />
              </div>
            )}
            {selectedChapterCode !== null && groupsQuery.isLoading && (
              <div className="space-y-2 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            )}
            {selectedChapterCode !== null && groupsQuery.isSuccess && (
              <ul className="flex-1 overflow-y-auto scroll-hover py-1">
                {groupSections.map((section) => (
                  <li key={section.blockCode}>
                    <div className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {section.blockCode} — {section.blockName}
                    </div>
                    <ul>
                      {section.groups.map((group) => {
                        const selected = selectedGroupCode === group.groupCode;
                        return (
                          <li key={group.groupCode}>
                            <button
                              type="button"
                              onClick={() => setSelectedGroupCode(group.groupCode)}
                              className={`w-full px-3 py-1.5 text-left text-sm font-medium ${
                                selected ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              <span className="font-bold">{group.groupCode}</span> {group.groupName}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Cột 3 — Bảng mã chi tiết */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selectedGroupCode === null && (
              <EmptyState
                icon={ListMagnifyingGlass}
                title="Chọn Nhóm bệnh để xem bảng mã"
                description="Chọn Chương rồi Nhóm bệnh ở 2 cột bên trái, hoặc dùng ô tìm nhanh ở trên."
              />
            )}
            {selectedGroupCode !== null && codesQuery.isError && (
              <ErrorBanner message="Không tải được bảng mã chi tiết." onRetry={() => codesQuery.refetch()} />
            )}
            {selectedGroupCode !== null && codesQuery.isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {selectedGroupCode !== null && codesQuery.isSuccess && (
              <Icd10Table items={codesQuery.data.items} emptyLabel="Nhóm này chưa có mã nào" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchResults({
  query,
  isLoading,
  isError,
  onRetry,
}: {
  query: Icd10CodeItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) return <ErrorBanner message="Không tìm được kết quả." onRetry={onRetry} />;
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }
  return <Icd10Table items={query ?? []} emptyLabel="Không tìm thấy mã ICD-10 nào khớp" />;
}

function Icd10Table({ items, emptyLabel }: { items: Icd10CodeItem[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <EmptyState icon={BookOpenText} title={emptyLabel} description="Thử từ khoá khác hoặc chọn lại Chương/Nhóm bệnh." />;
  }
  return (
    <div className="scroll-hover flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
            <th className="w-28 px-4 py-2.5 text-center">Mã</th>
            <th className="px-4 py-2.5 text-left">Tên bệnh</th>
            <th className="px-4 py-2.5 text-left">Tên tiếng Anh</th>
            <th className="w-56 px-4 py-2.5 text-center">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code} className="border-b border-slate-200 last:border-0 align-top">
              <td className="px-4 py-2 text-center font-bold text-slate-800">{item.code}</td>
              <td className="px-4 py-2 text-left font-medium text-slate-900">{item.nameVi}</td>
              <td className="px-4 py-2 text-left font-medium text-slate-600">{item.nameEn ?? '—'}</td>
              <td className="px-4 py-2 text-center">
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {item.genderRestriction && (
                    <span className="whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {GENDER_LABEL[item.genderRestriction]}
                    </span>
                  )}
                  {item.usageRestriction && (
                    <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {USAGE_LABEL[item.usageRestriction]}
                    </span>
                  )}
                  {!item.genderRestriction && !item.usageRestriction && <span className="text-slate-300">—</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}