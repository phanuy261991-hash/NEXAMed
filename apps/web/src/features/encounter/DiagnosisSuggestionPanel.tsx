import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Check, Plus, Sparkle } from '@phosphor-icons/react';
import type { DiagnosisSuggestionGroup, DiagnosisSuggestionItem } from '@nexamed/shared';
import { Skeleton } from '../../shared/ui/Skeleton';

export interface DiagnosisSuggestionPanelHandle {
  /** Đưa focus vào mã gợi ý đầu tiên (↓ hoặc Alt+↓ từ ô "Chẩn đoán"). `false` nếu không có mã nào để focus. */
  focusFirst: () => boolean;
}

/**
 * Khối "Gợi ý từ ô Chẩn đoán" (docs/DECISIONS.md — "Gợi ý mã ICD-10") — hiện các mã ICD-10 phù hợp với
 * từng cụm bệnh bác sĩ gõ ở ô "Chẩn đoán". CHỈ ĐỀ XUẤT: bác sĩ bấm từng mã mới thêm (`onAdd`), không có
 * nút "thêm tất cả". Component thuần trình bày — dữ liệu/hành động qua props, không tự gọi API, để
 * dùng lại được ở nơi khác cần gợi ý mã từ văn bản tự do.
 *
 * Bàn phím: `↑`/`↓` đổi mã (kể cả sang cụm kế), `Enter`/`Space` thêm, `Esc` hoặc `↑` ở mã đầu tiên quay
 * lại ô "Chẩn đoán" (`onRequestInputFocus`). Không chiếm phím Tab — Tab vẫn đi tuần tự như mọi form.
 * Lỗi mạng: caller không render khối này (ô tìm thủ công bên dưới vẫn dùng được).
 */
export const DiagnosisSuggestionPanel = forwardRef<
  DiagnosisSuggestionPanelHandle,
  {
    groups: DiagnosisSuggestionGroup[];
    /** Đang tải lần đầu (chưa có dữ liệu để hiện) — hiện skeleton. */
    isLoading: boolean;
    /** Mã đã có trong danh sách chẩn đoán — hiện "Đã thêm", không thêm trùng. */
    chosenCodes: string[];
    onAdd: (item: DiagnosisSuggestionItem, group: DiagnosisSuggestionGroup) => void;
    /** Cụm không có gợi ý nào → nút "Tìm thủ công" chuyển nội dung sang ô tìm ICD-10 ở dưới. */
    onManualSearch: (text: string) => void;
    onRequestInputFocus: () => void;
  }
>(function DiagnosisSuggestionPanel({ groups, isLoading, chosenCodes, onAdd, onManualSearch, onRequestInputFocus }, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  useImperativeHandle(
    ref,
    () => ({
      focusFirst: () => {
        const first = containerRef.current?.querySelector<HTMLButtonElement>('[data-suggestion-option]');
        first?.focus();
        return first !== null && first !== undefined;
      },
    }),
    [],
  );

  // Ô "Chẩn đoán" trống lại (không còn cụm nào) → quên các cụm đã "Bỏ qua", để lần gõ sau hiện lại bình thường.
  useEffect(() => {
    if (groups.length === 0 && dismissed.size > 0) {
      setDismissed(new Set());
    }
  }, [groups.length, dismissed.size]);

  const visibleGroups = groups.filter((g) => !dismissed.has(g.phraseKey));
  if (!isLoading && visibleGroups.length === 0) {
    return null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(containerRef.current?.querySelectorAll<HTMLButtonElement>('[data-suggestion-option]') ?? []);
    const index = options.findIndex((o) => o === document.activeElement);
    if (index < 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      options[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (index === 0) onRequestInputFocus();
      else options[index - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onRequestInputFocus();
    }
  }

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label="Gợi ý mã ICD-10 từ ô Chẩn đoán"
      onKeyDown={handleKeyDown}
      className="mb-3 rounded-lg border border-blue-100 bg-blue-50/40 px-3 pb-3 pt-2.5"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-700">
          <Sparkle size={14} weight="fill" aria-hidden="true" />
          Gợi ý từ ô Chẩn đoán
        </div>
        <p className="flex flex-wrap items-center gap-1 text-[11.5px] text-slate-600">
          <Kbd>↓</Kbd> hoặc <Kbd>Alt</Kbd>+<Kbd>↓</Kbd> vào gợi ý · <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> chọn · <Kbd>Enter</Kbd> thêm · <Kbd>Esc</Kbd> quay lại
        </p>
      </div>

      {isLoading && visibleGroups.length === 0 ? (
        <div className="space-y-1.5" aria-busy="true">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
        </div>
      ) : (
        <div className="divide-y divide-blue-100">
          {visibleGroups.map((group) => (
            <div key={group.phraseKey} className="grid grid-cols-1 gap-2 py-2 first:pt-0 last:pb-0 sm:grid-cols-[170px_minmax(0,1fr)]">
              <div className="min-w-0">
                <p className="break-words text-[13.5px] font-semibold text-slate-900">&ldquo;{group.phrase}&rdquo;</p>
                {group.expandedText && <p className="mt-0.5 text-[11.5px] text-slate-600">hiểu là: {group.expandedText}</p>}
                {group.followUp && (
                  <span className="mt-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Theo dõi</span>
                )}
                <div>
                  <button
                    type="button"
                    onClick={() => setDismissed((prev) => new Set(prev).add(group.phraseKey))}
                    className="mt-1 text-xs text-slate-500 hover:text-rose-600"
                  >
                    Bỏ qua cụm này
                  </button>
                </div>
              </div>

              {group.items.length === 0 ? (
                <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-slate-600">
                  Không tìm thấy mã khớp.
                  <button
                    type="button"
                    onClick={() => onManualSearch(group.expandedText ?? group.phrase)}
                    className="font-semibold text-blue-600 hover:text-blue-700"
                  >
                    Tìm thủ công &ldquo;{group.expandedText ?? group.phrase}&rdquo;
                  </button>
                </p>
              ) : (
                <ul className="flex min-w-0 flex-col gap-1.5">
                  {group.items.map((item) => {
                    const added = chosenCodes.includes(item.icd10Code);
                    return (
                      <li key={item.icd10Code}>
                        <button
                          type="button"
                          data-suggestion-option
                          aria-disabled={added}
                          onClick={() => {
                            if (!added) onAdd(item, group);
                          }}
                          className={`flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                            added
                              ? 'cursor-default border-emerald-300 bg-emerald-50'
                              : 'border-slate-300 bg-white hover:border-blue-400 hover:bg-brand-teal-tint focus-visible:border-blue-500'
                          }`}
                        >
                          <span className="w-12 flex-shrink-0 text-[13.5px] font-bold tabular-nums text-slate-900">{item.icd10Code}</span>
                          <span className="min-w-0 flex-1 text-[13.5px] text-slate-800">{item.icd10Name}</span>
                          <ReasonChip item={item} />
                          <span className={`flex flex-shrink-0 items-center gap-1 text-xs font-bold ${added ? 'text-emerald-700' : 'text-blue-600'}`}>
                            {added ? <Check size={13} weight="bold" aria-hidden="true" /> : <Plus size={13} weight="bold" aria-hidden="true" />}
                            {added ? 'Đã thêm' : 'Thêm'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-b-2 border-slate-300 bg-white px-1 text-[11px] font-semibold text-slate-600">{children}</kbd>
  );
}

/** Nhãn phân loại lý do gợi ý (chip phân loại, không phải trạng thái thực thể — xem ui-guidelines.md 2.1a ngoại lệ 4). */
function ReasonChip({ item }: { item: DiagnosisSuggestionItem }) {
  if (item.reason === 'PHRASE_HISTORY') {
    return (
      <span className="hidden flex-shrink-0 rounded-full bg-brand-teal-tint px-2 py-0.5 text-[11px] font-semibold text-brand-teal sm:inline">
        Bạn chọn cho cụm này {item.usageCount} lần
      </span>
    );
  }
  if (item.reason === 'HISTORY') {
    return (
      <span className="hidden flex-shrink-0 rounded-full bg-brand-teal-tint px-2 py-0.5 text-[11px] font-semibold text-brand-teal sm:inline">
        Bạn dùng {item.usageCount} lần
      </span>
    );
  }
  return <span className="hidden flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600 sm:inline">Khớp tên bệnh</span>;
}
